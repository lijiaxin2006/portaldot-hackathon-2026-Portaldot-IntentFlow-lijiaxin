//! Chain-neutral types for the local cross-chain simulation.
//!
//! These values describe an intent and its state transitions only. They do not
//! claim to be compatible with a bridge protocol or provide remote-chain
//! proofs.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{Balance, Hash, NetworkId};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum ChainAssetKind {
    Native,
    Contract,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ChainAssetRef {
    pub network_id: NetworkId,
    pub kind: ChainAssetKind,
    pub locator: Vec<u8>,
}

impl ChainAssetRef {
    pub fn validate(&self) -> Result<(), CrossChainError> {
        if self.locator.is_empty() {
            return Err(CrossChainError::EmptyLocator);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct CrossChainIntent {
    pub intent_id: Hash,
    pub source_network: NetworkId,
    pub target_network: NetworkId,
    pub source_owner: Vec<u8>,
    pub source_contract: Vec<u8>,
    pub target_contract: Vec<u8>,
    pub asset_in: ChainAssetRef,
    pub asset_out: ChainAssetRef,
    pub mapping_version: String,
    pub amount_in: Balance,
    pub min_amount_out: Balance,
    pub max_total_fee: Balance,
    pub source_deadline: u64,
    pub target_deadline: u64,
    pub route_hash: Hash,
    pub message_nonce: u64,
}

impl CrossChainIntent {
    pub fn validate(&self) -> Result<(), CrossChainError> {
        if self.intent_id == [0; 32] {
            return Err(CrossChainError::ZeroHash("intent"));
        }
        if self.source_network == self.target_network {
            return Err(CrossChainError::SameNetwork);
        }
        if self.source_owner.is_empty()
            || self.source_contract.is_empty()
            || self.target_contract.is_empty()
        {
            return Err(CrossChainError::EmptyIdentity);
        }
        self.asset_in.validate()?;
        self.asset_out.validate()?;
        if self.asset_in.network_id != self.source_network
            || self.asset_out.network_id != self.target_network
        {
            return Err(CrossChainError::AssetNetworkMismatch);
        }
        if self.mapping_version.trim().is_empty() {
            return Err(CrossChainError::EmptyMappingVersion);
        }
        if self.amount_in == 0 {
            return Err(CrossChainError::ZeroAmount);
        }
        if self.route_hash == [0; 32] {
            return Err(CrossChainError::ZeroHash("route"));
        }
        if self.message_nonce == 0 {
            return Err(CrossChainError::ZeroNonce);
        }
        if self.source_deadline == 0 || self.target_deadline == 0 {
            return Err(CrossChainError::ZeroDeadline);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct CrossChainMessage {
    pub protocol_version: u16,
    pub source_network: NetworkId,
    pub target_network: NetworkId,
    pub source_contract: Vec<u8>,
    pub target_contract: Vec<u8>,
    pub intent_id: Hash,
    pub source_owner: Vec<u8>,
    pub nonce: u64,
    pub asset_in: ChainAssetRef,
    pub asset_out: ChainAssetRef,
    pub mapping_version: String,
    pub route_hash: Hash,
    pub amount_in: Balance,
    pub min_amount_out: Balance,
    pub max_total_fee: Balance,
    pub source_deadline: u64,
    pub target_deadline: u64,
    pub message_hash: Hash,
}

impl CrossChainMessage {
    #[must_use]
    pub fn without_hash(&self) -> Self {
        let mut message = self.clone();
        message.message_hash = [0; 32];
        message
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum CrossChainStatus {
    Created,
    Locked,
    SourceFinalized,
    MessageSent,
    TargetAccepted,
    TargetExecuted,
    SettlementPending,
    Settled,
    Cancelled,
    SourceReverted,
    RefundPending,
    Refunded,
    MessageExpired,
    TargetRejected,
    TargetFailed,
    CompensationPending,
    Paused,
}

impl CrossChainStatus {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Created => "created",
            Self::Locked => "locked",
            Self::SourceFinalized => "source_finalized",
            Self::MessageSent => "message_sent",
            Self::TargetAccepted => "target_accepted",
            Self::TargetExecuted => "target_executed",
            Self::SettlementPending => "settlement_pending",
            Self::Settled => "settled",
            Self::Cancelled => "cancelled",
            Self::SourceReverted => "source_reverted",
            Self::RefundPending => "refund_pending",
            Self::Refunded => "refunded",
            Self::MessageExpired => "message_expired",
            Self::TargetRejected => "target_rejected",
            Self::TargetFailed => "target_failed",
            Self::CompensationPending => "compensation_pending",
            Self::Paused => "paused",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum CrossChainEventKind {
    Create,
    Lock,
    SourceFinalized,
    MessageSent,
    TargetAccepted,
    TargetExecuted,
    SettlementPending,
    Settled,
    Cancelled,
    SourceReverted,
    RefundPending,
    Refunded,
    MessageExpired,
    TargetRejected,
    TargetFailed,
    CompensationPending,
    Paused,
    SimBlockCreated,
    SimBlockFinalized,
    SimBlockReverted,
    PrerequisitePending,
    DuplicateMessage,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum CrossChainReasonCode {
    InvalidTransition,
    SourceNotFinalized,
    CannotRevertFinalizedBlock,
    MessageExpired,
    NonceConflict,
    PrerequisitePending,
    TargetRejected,
    InsufficientLiquidity,
    StateReconciliationConflict,
    DuplicateMessage,
    SourceReverted,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct CrossChainTransition {
    pub from: CrossChainStatus,
    pub to: CrossChainStatus,
    pub event: CrossChainEventKind,
    pub reason: Option<CrossChainReasonCode>,
}

pub fn transition(
    current: CrossChainStatus,
    event: CrossChainEventKind,
) -> Result<CrossChainTransition, CrossChainError> {
    let to = match (current, event) {
        (CrossChainStatus::Created, CrossChainEventKind::Lock) => CrossChainStatus::Locked,
        (CrossChainStatus::Created, CrossChainEventKind::Cancelled) => CrossChainStatus::Cancelled,
        (CrossChainStatus::Locked, CrossChainEventKind::SourceFinalized) => {
            CrossChainStatus::SourceFinalized
        }
        (CrossChainStatus::Locked, CrossChainEventKind::SourceReverted) => {
            CrossChainStatus::SourceReverted
        }
        (CrossChainStatus::Locked, CrossChainEventKind::RefundPending) => {
            CrossChainStatus::RefundPending
        }
        (CrossChainStatus::SourceFinalized, CrossChainEventKind::MessageSent) => {
            CrossChainStatus::MessageSent
        }
        (CrossChainStatus::SourceFinalized, CrossChainEventKind::MessageExpired) => {
            CrossChainStatus::MessageExpired
        }
        (CrossChainStatus::MessageSent, CrossChainEventKind::TargetAccepted) => {
            CrossChainStatus::TargetAccepted
        }
        (CrossChainStatus::MessageSent, CrossChainEventKind::TargetRejected) => {
            CrossChainStatus::TargetRejected
        }
        (CrossChainStatus::MessageSent, CrossChainEventKind::MessageExpired) => {
            CrossChainStatus::MessageExpired
        }
        (CrossChainStatus::TargetAccepted, CrossChainEventKind::TargetExecuted) => {
            CrossChainStatus::TargetExecuted
        }
        (CrossChainStatus::TargetAccepted, CrossChainEventKind::TargetFailed) => {
            CrossChainStatus::TargetFailed
        }
        (CrossChainStatus::TargetExecuted, CrossChainEventKind::SettlementPending) => {
            CrossChainStatus::SettlementPending
        }
        (CrossChainStatus::SettlementPending, CrossChainEventKind::Settled) => {
            CrossChainStatus::Settled
        }
        (CrossChainStatus::MessageExpired, CrossChainEventKind::RefundPending)
        | (CrossChainStatus::TargetRejected, CrossChainEventKind::RefundPending)
        | (CrossChainStatus::TargetFailed, CrossChainEventKind::CompensationPending)
        | (CrossChainStatus::CompensationPending, CrossChainEventKind::RefundPending) => {
            match event {
                CrossChainEventKind::CompensationPending => CrossChainStatus::CompensationPending,
                _ => CrossChainStatus::RefundPending,
            }
        }
        (CrossChainStatus::RefundPending, CrossChainEventKind::Refunded) => {
            CrossChainStatus::Refunded
        }
        (CrossChainStatus::Created, CrossChainEventKind::Paused)
        | (CrossChainStatus::Locked, CrossChainEventKind::Paused)
        | (CrossChainStatus::SourceFinalized, CrossChainEventKind::Paused)
        | (CrossChainStatus::MessageSent, CrossChainEventKind::Paused)
        | (CrossChainStatus::TargetAccepted, CrossChainEventKind::Paused)
        | (CrossChainStatus::TargetExecuted, CrossChainEventKind::Paused)
        | (CrossChainStatus::SettlementPending, CrossChainEventKind::Paused) => {
            CrossChainStatus::Paused
        }
        _ => return Err(CrossChainError::InvalidTransition { current, event }),
    };
    Ok(CrossChainTransition {
        from: current,
        to,
        event,
        reason: None,
    })
}

#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum CrossChainError {
    #[error("cross-chain intent hash is zero: {0}")]
    ZeroHash(&'static str),
    #[error("source and target networks must differ")]
    SameNetwork,
    #[error("cross-chain identity must not be empty")]
    EmptyIdentity,
    #[error("asset locator must not be empty")]
    EmptyLocator,
    #[error("asset network does not match intent network")]
    AssetNetworkMismatch,
    #[error("mapping version must not be empty")]
    EmptyMappingVersion,
    #[error("cross-chain amount must be greater than zero")]
    ZeroAmount,
    #[error("message nonce must be greater than zero")]
    ZeroNonce,
    #[error("cross-chain deadline must be greater than zero")]
    ZeroDeadline,
    #[error("invalid cross-chain transition from {current:?} using {event:?}")]
    InvalidTransition {
        current: CrossChainStatus,
        event: CrossChainEventKind,
    },
}
