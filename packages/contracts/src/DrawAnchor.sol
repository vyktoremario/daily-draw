// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

/// @title DrawAnchor
/// @notice Public, permanent record of each naira draw's fairness inputs
///         (design: "Draw and fairness protocol", steps 1 and 3).
/// @dev The operator's worker writes one anchor per draw at the cutoff, before the
///      drand round exists. Anchors can never be changed or overwritten, so anyone can
///      later prove the ticket list and seed commitment were fixed in advance.
contract DrawAnchor {
    struct Anchor {
        bytes32 commitment; // SHA-256("DD-v1" || drawId || seed), published when sales opened
        bytes32 merkleRoot; // root of all tickets at the cutoff
        uint64 drandRound; // drand round named in advance
        uint32 ticketCount;
        uint128 salesKobo;
        uint64 anchoredAt;
    }

    /// @notice The only address allowed to write anchors (the operator's worker key).
    address public immutable anchorer;

    mapping(uint256 drawNumber => Anchor) private anchors;

    event DrawAnchored(
        uint256 indexed drawNumber,
        bytes32 commitment,
        bytes32 merkleRoot,
        uint64 drandRound,
        uint32 ticketCount,
        uint128 salesKobo
    );

    error NotAnchorer();
    error AlreadyAnchored(uint256 drawNumber);
    error EmptyCommitment();

    constructor(address anchorer_) {
        anchorer = anchorer_;
    }

    function anchor(
        uint256 drawNumber,
        bytes32 commitment,
        bytes32 merkleRoot,
        uint64 drandRound,
        uint32 ticketCount,
        uint128 salesKobo
    ) external {
        if (msg.sender != anchorer) revert NotAnchorer();
        if (commitment == bytes32(0)) revert EmptyCommitment();
        if (anchors[drawNumber].anchoredAt != 0) revert AlreadyAnchored(drawNumber);

        anchors[drawNumber] = Anchor({
            commitment: commitment,
            merkleRoot: merkleRoot,
            drandRound: drandRound,
            ticketCount: ticketCount,
            salesKobo: salesKobo,
            anchoredAt: uint64(block.timestamp)
        });
        emit DrawAnchored(drawNumber, commitment, merkleRoot, drandRound, ticketCount, salesKobo);
    }

    function getAnchor(uint256 drawNumber) external view returns (Anchor memory) {
        return anchors[drawNumber];
    }

    function isAnchored(uint256 drawNumber) external view returns (bool) {
        return anchors[drawNumber].anchoredAt != 0;
    }
}
