use defi_domain::{
    AccountId, AssetId, BlockRef, ContractId, NetworkId, PoolKind, PoolSnapshot, SwapIntent,
};
use defi_engine::{RiskConfig, RouteGraph};
use portaldot_solver::{SolverConfig, evaluate};
use std::error::Error;

fn main() -> Result<(), Box<dyn Error>> {
    let asset_a = AssetId::Contract(contract_id(1));
    let asset_b = AssetId::Contract(contract_id(2));
    let asset_c = AssetId::Contract(contract_id(3));
    let block = BlockRef::new(100, [0x42; 32])?;

    let graph = RouteGraph {
        network: NetworkId::new("local-demo")?,
        block,
        pools: vec![
            pool(11, asset_a, asset_b, 100_000_000, 102_000_000, block),
            pool(12, asset_a, asset_c, 100_000_000, 102_000_000, block),
            pool(13, asset_b, asset_c, 103_000_000, 100_000_000, block),
        ],
    };
    let intent = SwapIntent {
        intent_id: [1; 32],
        owner: AccountId([0xa5; 32]),
        asset_in: asset_a,
        asset_out: asset_b,
        amount_in: 1_000_000,
        amount_out_min: 1_000_000,
        max_fee: 100_000,
        deadline: 200,
    };
    let config = SolverConfig {
        max_hops: 2,
        risk: RiskConfig {
            max_price_impact_bps: 150,
            ..RiskConfig::default()
        },
        ..SolverConfig::default()
    };
    let report = evaluate(&graph, intent, config)?;

    println!("network=local-demo (no RPC, signing, or broadcast)");
    println!(
        "intent: amount_in={} A->B, min_out={}, max_fee={}",
        report.intent.amount_in, report.intent.amount_out_min, report.intent.max_fee
    );
    println!("candidate_count={}", report.candidates.len());
    for candidate in &report.candidates {
        let path = candidate
            .route
            .steps
            .iter()
            .map(|step| {
                format!(
                    "{}->{}@pool-{}",
                    asset_label(step.asset_in, asset_a, asset_b, asset_c),
                    asset_label(step.asset_out, asset_a, asset_b, asset_c),
                    step.pool_id.0[31]
                )
            })
            .collect::<Vec<_>>()
            .join(",");
        let amount_out = candidate
            .quote
            .as_ref()
            .map_or_else(|| "-".to_owned(), |quote| quote.amount_out.to_string());
        let risk_score = candidate
            .risk
            .as_ref()
            .map_or_else(|| "-".to_owned(), |risk| risk.score.to_string());
        let price_impact = candidate
            .risk
            .as_ref()
            .map_or_else(|| "-".to_owned(), |risk| risk.price_impact_bps.to_string());
        println!(
            "candidate: path={path} hops={} amount_out={amount_out} risk_score={risk_score} price_impact_bps={price_impact} accepted={} reason={}",
            candidate.route.steps.len(),
            candidate.accepted,
            candidate.rejection_reason.as_deref().unwrap_or("none")
        );
    }

    if let Some(route_hash) = report.selected_route_hash {
        println!("selected_route_hash={}", hex(&route_hash));
        println!("report_hash={}", hex(&report.report_hash));
    } else {
        println!(
            "no route selected: {}",
            report.rejection_reason.as_deref().unwrap_or("unknown")
        );
    }
    Ok(())
}

fn contract_id(last_byte: u8) -> ContractId {
    let mut bytes = [0; 32];
    bytes[31] = last_byte;
    ContractId(bytes)
}

fn pool(
    pool_id: u8,
    asset_0: AssetId,
    asset_1: AssetId,
    reserve_0: u128,
    reserve_1: u128,
    observed_at: BlockRef,
) -> PoolSnapshot {
    PoolSnapshot {
        pool_id: contract_id(pool_id),
        kind: PoolKind::ConstantProduct,
        asset_0,
        asset_1,
        reserve_0,
        reserve_1,
        fee_bps: 30,
        observed_at,
        code_hash: None,
    }
}

fn asset_label(
    asset: AssetId,
    asset_a: AssetId,
    asset_b: AssetId,
    asset_c: AssetId,
) -> &'static str {
    if asset == asset_a {
        "A"
    } else if asset == asset_b {
        "B"
    } else if asset == asset_c {
        "C"
    } else {
        "?"
    }
}

fn hex(bytes: &[u8; 32]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
