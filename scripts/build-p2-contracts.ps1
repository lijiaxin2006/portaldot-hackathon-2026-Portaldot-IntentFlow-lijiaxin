$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$contractsRoot = Join-Path $root "contracts"
$artifactDir = Join-Path $root "target\p2-contracts"
$toolArtifactDir = Join-Path $root "target\p2-tools"
$rustcWrapperSource = Join-Path $root "tools\rustc-wasm-mvp-wrapper.rs"
$rustcWrapperPath = Join-Path $toolArtifactDir "rustc-wasm-mvp-wrapper"
$toolManifest = Join-Path $root "tools\p0-wasm-postprocess\Cargo.toml"
$useDocker = $env:OS -eq "Windows_NT" -or -not (Get-Command cargo-contract -ErrorAction SilentlyContinue)
$dockerImage = "rust:1.90-slim-bookworm"
$cargoHomeVolume = "intentflow-p2-cargo-home"
$rustupHomeVolume = "intentflow-p2-rustup-home"
$contracts = @(
    @{ Package = "intentflow_psp22_test_token"; Directory = "psp22-test-token"; Artifact = "intentflow_psp22_test_token" },
    @{ Package = "intentflow_amm_pool"; Directory = "amm-pool"; Artifact = "intentflow_amm_pool" },
    @{ Package = "intentflow_intent_router"; Directory = "intent-router"; Artifact = "intentflow_intent_router" }
)

if ($useDocker) {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw "Docker is required for the pinned Linux contract build environment."
    }
    $volumes = @(& docker volume ls --format "{{.Name}}")
    foreach ($volume in @($cargoHomeVolume, $rustupHomeVolume)) {
        if ($volume -notin $volumes) {
            & docker volume create $volume | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "Could not create Docker volume '$volume'." }
        }
    }
} else {
    $contractVersion = & cargo contract --version
    if ($LASTEXITCODE -ne 0 -or $contractVersion -notmatch "4\.1\.3") {
        throw "Expected cargo-contract 4.1.3, found '$contractVersion'."
    }
    if (-not (rustup target list --installed | Select-String -SimpleMatch "wasm32-unknown-unknown")) {
        throw "Install the wasm32-unknown-unknown Rust target before building contracts."
    }
}

New-Item -ItemType Directory -Path $artifactDir -Force | Out-Null
New-Item -ItemType Directory -Path $toolArtifactDir -Force | Out-Null
if (-not $useDocker) {
    & rustc $rustcWrapperSource -o $rustcWrapperPath
    if ($LASTEXITCODE -ne 0) { throw "Could not compile the Wasm MVP rustc wrapper." }
}

foreach ($contract in $contracts) {
    $manifest = Join-Path (Join-Path $contractsRoot $contract.Directory) "Cargo.toml"
    $cargoContractWasm = Join-Path $contractsRoot ("target\ink\{0}\{0}.wasm" -f $contract.Artifact)
    $optimizedWasm = Join-Path $artifactDir ("{0}.optimized.wasm" -f $contract.Artifact)
    $deployableWasm = Join-Path $artifactDir ("{0}.deployable.wasm" -f $contract.Artifact)
    $bundlePath = Join-Path $artifactDir ("{0}.contract" -f $contract.Artifact)

    if ($useDocker) {
        $containerScript = @'
set -e
export CARGO_HOME=/root/.cargo
export RUSTUP_HOME=/root/.rustup
export PATH=/root/.rustup/toolchains/1.90.0-x86_64-unknown-linux-gnu/bin:/root/.cargo/bin:/usr/local/cargo/bin:$PATH
if [ ! -x /root/.rustup/toolchains/1.90.0-x86_64-unknown-linux-gnu/bin/cargo ]; then
    echo 'Pinned Rust 1.90.0 toolchain is missing from the Docker rustup volume.' >&2
    exit 1
fi
if [ ! -d /root/.rustup/toolchains/1.90.0-x86_64-unknown-linux-gnu/lib/rustlib/wasm32-unknown-unknown ]; then
    echo 'The wasm32-unknown-unknown target is missing from the Docker rustup volume.' >&2
    exit 1
fi
rustc /workspace/tools/rustc-wasm-mvp-wrapper.rs -o /workspace/target/p2-tools/rustc-wasm-mvp-wrapper
export RUSTC_WRAPPER=/workspace/target/p2-tools/rustc-wasm-mvp-wrapper
if ! cargo contract --version | grep -q '4.1.3'; then
    cargo install cargo-contract --version 4.1.3 --locked
fi
cargo contract build --manifest-path "$1" --release
'@
        $containerManifest = "/workspace/contracts/$($contract.Directory)/Cargo.toml"
        $dockerWorkspace = $root.Replace('\', '/')
        $dockerArgs = @(
            "run", "--rm",
            "--mount", "type=bind,source=$dockerWorkspace,target=/workspace",
            "--mount", "type=volume,source=$cargoHomeVolume,target=/root/.cargo",
            "--mount", "type=volume,source=$rustupHomeVolume,target=/root/.rustup",
            "-e", "CARGO_HOME=/root/.cargo",
            "-e", "RUSTUP_HOME=/root/.rustup",
            "-w", "/workspace",
            $dockerImage,
            "bash", "-lc", $containerScript, "bash", $containerManifest
        )
        & docker @dockerArgs
        if ($LASTEXITCODE -ne 0) { throw "Linux contract build failed for $($contract.Package)." }
    } else {
        $previousRustcWrapper = $env:RUSTC_WRAPPER
        $env:RUSTC_WRAPPER = $rustcWrapperPath
        try {
            & cargo contract build --manifest-path $manifest --release
            if ($LASTEXITCODE -ne 0) { throw "cargo-contract build failed for $($contract.Package)." }
        } finally {
            if ($null -eq $previousRustcWrapper) {
                Remove-Item Env:RUSTC_WRAPPER -ErrorAction SilentlyContinue
            } else {
                $env:RUSTC_WRAPPER = $previousRustcWrapper
            }
        }
    }

    if (-not (Test-Path -LiteralPath $cargoContractWasm)) {
        throw "Expected cargo-contract Wasm output not found: $cargoContractWasm"
    }
    # The pinned contract build reserves the low memory region, so Binaryen can
    # safely remove unused bytes there in addition to the normal size passes.
    & npm exec --yes --package=binaryen@132.0.0 -- wasm-opt $cargoContractWasm -Oz --llvm-memory-copy-fill-lowering --low-memory-unused -o $optimizedWasm
    if ($LASTEXITCODE -ne 0) { throw "wasm-opt optimization failed for $($contract.Package)." }
    if (-not (Test-Path -LiteralPath $optimizedWasm)) {
        throw "wasm-opt did not produce an optimized Wasm for $($contract.Package)."
    }

    & cargo run --manifest-path $toolManifest --release --target-dir (Join-Path $root "target") -- $optimizedWasm $deployableWasm
    if ($LASTEXITCODE -ne 0) { throw "Portaldot Wasm validation failed for $($contract.Package)." }

    $bundle = Get-ChildItem -Path $contractsRoot -Filter ("{0}.contract" -f $contract.Artifact) -File -Recurse | Select-Object -First 1
    if (-not $bundle) { throw "cargo-contract did not produce $($contract.Artifact).contract." }
    Copy-Item -LiteralPath $bundle.FullName -Destination $bundlePath -Force

    $wasmHash = Get-FileHash -LiteralPath $deployableWasm -Algorithm SHA256
    $metadataHash = (Get-FileHash -LiteralPath $bundlePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $rawBytes = (Get-Item -LiteralPath $cargoContractWasm).Length
    $optimizedBytes = (Get-Item -LiteralPath $optimizedWasm).Length
    $deployableBytes = (Get-Item -LiteralPath $deployableWasm).Length
    Write-Output ("{0}: raw_wasm_bytes={1} wasm_opt_bytes={2} deployable_wasm_bytes={3} wasm_opt_saved_bytes={4} wasm_sha256={5} bundle_sha256={6}" -f $contract.Package, $rawBytes, $optimizedBytes, $deployableBytes, ($rawBytes - $optimizedBytes), $wasmHash.Hash.ToLowerInvariant(), $metadataHash)
}
