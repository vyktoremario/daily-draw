// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IRandomnessConsumer, IRandomnessProvider} from "../interfaces/IRandomnessProvider.sol";
import {IVRFCoordinatorV2Plus} from "../vendor/chainlink/IVRFCoordinatorV2Plus.sol";
import {VRFV2PlusClient} from "../vendor/chainlink/VRFV2PlusClient.sol";

/// @notice `IRandomnessProvider` backed by Chainlink VRF v2.5 (subscription method).
///
/// Flow: DailyDraw (the consumer) calls `requestRandomness` when a draw closes; this contract asks
/// the coordinator for one random word, paid from the VRF subscription. The coordinator checks the
/// VRF proof and calls `rawFulfillRandomWords`, which hands the word to
/// `DailyDraw.fulfillRandomness`. Only the coordinator can fulfil, only once per request, and only
/// the consumer can request (so nobody else can spend the subscription's LINK).
///
/// This contract, not DailyDraw, must be added as a consumer of the subscription (vrf.chain.link).
///
/// The owner (the admin wallet) can tune the gas lane, confirmations and callback gas limit. It
/// can't influence the random number: the coordinator verifies every proof. The consumer is set
/// once; switching to another game means a new adapter, through DailyDraw's timelocked
/// `setRandomnessProvider`.
contract ChainlinkVrfProvider is IRandomnessProvider, Ownable {
    struct VrfConfig {
        bytes32 keyHash; // gas lane
        uint256 subscriptionId;
        uint16 requestConfirmations;
        uint32 callbackGasLimit; // gas for rawFulfillRandomWords, including DailyDraw's settlement
        bool nativePayment; // false: pay in LINK; true: in the chain's native token
    }

    IVRFCoordinatorV2Plus public immutable coordinator;
    /// @notice The game that may request randomness and receives it. Set once.
    address public consumer;
    VrfConfig public config;
    /// @notice Requests sent and not yet answered.
    mapping(uint256 requestId => bool) public pending;

    event ConsumerSet(address consumer);
    event VrfConfigChanged(VrfConfig config);
    event RandomnessRequested(uint256 indexed requestId);
    event RandomnessFulfilled(uint256 indexed requestId, uint256 value);

    error ZeroAddress();
    error ConsumerAlreadySet(address consumer);
    error OnlyConsumer(address caller);
    error OnlyCoordinatorCanFulfill(address have, address want);
    error UnknownRequest(uint256 requestId);
    error NoRandomWords(uint256 requestId);
    error InvalidConfig();

    constructor(IVRFCoordinatorV2Plus coordinator_, VrfConfig memory config_, address owner_)
        Ownable(owner_)
    {
        if (address(coordinator_) == address(0)) revert ZeroAddress();
        coordinator = coordinator_;
        _setConfig(config_);
    }

    /// @notice Point the adapter at its game. Once only.
    function setConsumer(address consumer_) external onlyOwner {
        if (consumer_ == address(0)) revert ZeroAddress();
        if (consumer != address(0)) revert ConsumerAlreadySet(consumer);
        consumer = consumer_;
        emit ConsumerSet(consumer_);
    }

    function setConfig(VrfConfig calldata config_) external onlyOwner {
        _setConfig(config_);
    }

    /// @inheritdoc IRandomnessProvider
    function requestRandomness() external returns (uint256 requestId) {
        if (msg.sender != consumer) revert OnlyConsumer(msg.sender);
        VrfConfig memory c = config;
        requestId = coordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: c.keyHash,
                subId: c.subscriptionId,
                requestConfirmations: c.requestConfirmations,
                callbackGasLimit: c.callbackGasLimit,
                numWords: 1,
                extraArgs: VRFV2PlusClient._argsToBytes(
                    VRFV2PlusClient.ExtraArgsV1({nativePayment: c.nativePayment})
                )
            })
        );
        pending[requestId] = true;
        emit RandomnessRequested(requestId);
    }

    /// @notice Called by the VRF coordinator once it has verified the proof.
    /// @dev Same name, arguments and error as Chainlink's `VRFConsumerBaseV2Plus`, which the
    ///      coordinator calls. A revert here (or in DailyDraw) doesn't revert the coordinator: it
    ///      records the request as answered with a failed callback, and the draw can then be voided.
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external {
        if (msg.sender != address(coordinator)) {
            revert OnlyCoordinatorCanFulfill(msg.sender, address(coordinator));
        }
        if (!pending[requestId]) revert UnknownRequest(requestId);
        if (randomWords.length == 0) revert NoRandomWords(requestId);
        delete pending[requestId];
        emit RandomnessFulfilled(requestId, randomWords[0]);
        IRandomnessConsumer(consumer).fulfillRandomness(requestId, randomWords[0]);
    }

    function _setConfig(VrfConfig memory c) private {
        if (c.keyHash == bytes32(0) || c.subscriptionId == 0 || c.callbackGasLimit == 0) {
            revert InvalidConfig();
        }
        config = c;
        emit VrfConfigChanged(c);
    }
}
