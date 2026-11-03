$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$contractManifest = Join-Path $root "contracts/p0-probe/Cargo.toml"
$toolManifest = Join-Path $root "tools/p0-wasm-postprocess/Cargo.toml"
$targetDir = Join-Path $root "contracts/p0-probe/target/wasm32-unknown-unknown/release"
$inputWasm = Join-Path $targetDir "portaldot_p0_probe.wasm"
$optimizedWasm = Join-Path $targetDir "portaldot_p0_probe.optimized.wasm"
$outputWasm = Join-Path $targetDir "portaldot_p0_probe.deployable.wasm"
$flags = '["-Ctarget-cpu=mvp","-Clink-arg=--import-memory","-Clink-arg=-zstack-size=65536"]'

& cargo build --manifest-path $contractManifest --release --target wasm32-unknown-unknown --no-default-features --config "build.rustflags=$flags"
if ($LASTEXITCODE -ne 0) {
    throw "P0 probe Wasm build failed with exit code $LASTEXITCODE"
}

& npm exec --yes --package=binaryen@132.0.0 -- wasm-opt $inputWasm -Oz --llvm-memory-copy-fill-lowering -o $optimizedWasm
if ($LASTEXITCODE -ne 0) {
    throw "P0 probe wasm-opt optimization failed with exit code $LASTEXITCODE"
}

& cargo run --manifest-path $toolManifest --release --target-dir (Join-Path $root "target") -- $optimizedWasm $outputWasm
if ($LASTEXITCODE -ne 0) {
    throw "P0 probe Wasm post-processing failed with exit code $LASTEXITCODE"
}

Get-FileHash -LiteralPath $outputWasm -Algorithm SHA256
