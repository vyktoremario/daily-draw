// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {IVRFCoordinatorV2Plus} from "../../src/vendor/chainlink/IVRFCoordinatorV2Plus.sol";
import {VRFV2PlusClient} from "../../src/vendor/chainlink/VRFV2PlusClient.sol";

/// @notice Stands in for Chainlink's VRF v2.5 coordinator: checks the caller is a consumer of the
///         subscription, records the request, and on `fulfill` calls `rawFulfillRandomWords` with
///         the request's callback gas limit, swallowing a failed callback as the real one does.
contract MockVrfCoordinator is IVRFCoordinatorV2Plus {
    struct Request {
        address consumer;
        bytes32 keyHash;
        uint256 subId;
        uint16 requestConfirmations;
        uint32 callbackGasLimit;
        uint32 numWords;
        bytes extraArgs;
        bool fulfilled;
    }

    mapping(uint256 subId => mapping(address consumer => bool)) public isConsumer;
    mapping(uint256 requestId => Request) internal _requests;
    uint256 public lastRequestId;
    uint256 internal nonce;

    event RandomWordsFulfilled(uint256 indexed requestId, bool success);

    error InvalidConsumer(uint256 subId, address consumer);
    error AlreadyFulfilled(uint256 requestId);
    error InsufficientGasForConsumer(uint256 have, uint256 want);

    function addConsumer(uint256 subId, address consumer) external {
        isConsumer[subId][consumer] = true;
    }

    function requestRandomWords(VRFV2PlusClient.RandomWordsRequest calldata req)
        external
        returns (uint256 requestId)
    {
        if (!isConsumer[req.subId][msg.sender]) {
            revert InvalidConsumer(req.subId, msg.sender);
        }
        // Real request ids are hashes too: large, unordered numbers.
        requestId = uint256(keccak256(abi.encode(req.keyHash, msg.sender, req.subId, ++nonce)));
        _requests[requestId] = Request({
            consumer: msg.sender,
            keyHash: req.keyHash,
            subId: req.subId,
            requestConfirmations: req.requestConfirmations,
            callbackGasLimit: req.callbackGasLimit,
            numWords: req.numWords,
            extraArgs: req.extraArgs,
            fulfilled: false
        });
        lastRequestId = requestId;
    }

    function request(uint256 requestId) external view returns (Request memory) {
        return _requests[requestId];
    }

    /// @return success Whether the consumer's callback succeeded.
    /// @return gasUsed Gas the callback used (out of the request's callback gas limit).
    function fulfill(uint256 requestId, uint256 word)
        external
        returns (bool success, uint256 gasUsed)
    {
        Request storage r = _requests[requestId];
        if (r.fulfilled) revert AlreadyFulfilled(requestId);
        r.fulfilled = true;
        uint256[] memory words = new uint256[](r.numWords);
        for (uint256 i; i < words.length; ++i) {
            words[i] = uint256(keccak256(abi.encode(word, i)));
        }
        if (words.length != 0) words[0] = word;
        bytes memory data =
            abi.encodeWithSignature("rawFulfillRandomWords(uint256,uint256[])", requestId, words);
        // Like Chainlink's `_callWithExactGas`: refuse to start unless the callback can get its whole
        // gas limit, so a low gas estimate reverts here instead of starving the consumer.
        if (gasleft() < uint256(r.callbackGasLimit) * 64 / 63 + 10_000) {
            revert InsufficientGasForConsumer(gasleft(), r.callbackGasLimit);
        }
        uint256 before = gasleft();
        (success,) = r.consumer.call{gas: r.callbackGasLimit}(data);
        gasUsed = before - gasleft();
        emit RandomWordsFulfilled(requestId, success);
    }
}
