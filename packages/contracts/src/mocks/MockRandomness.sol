// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IRandomnessOracle.sol";

/// @title MockRandomness
/// @notice Test helper that simulates a two-step randomness oracle (Witnet-compatible).
///         In tests, call randomize() then fulfillBlock() to provide randomness.
///         On testnet, the operator calls fulfillBlock() manually after each draw request.
contract MockRandomness is IRandomnessOracle {
    /// @notice The deterministic random value to return (settable for testing)
    bytes32 public mockRandomWord = bytes32(uint256(12345678901234567890));

    /// @notice Block numbers that have been randomized
    mapping(uint256 => bytes32) private _randomizedBlocks;

    event RandomnessRequested(uint256 blockNumber);
    event RandomnessFulfilled(uint256 blockNumber, bytes32 randomWord);

    function estimateRandomizeFee(uint256 /* evmGasPrice */) external pure override returns (uint256) {
        return 0; // Free in mock
    }

    function randomize() external payable override returns (uint256) {
        emit RandomnessRequested(block.number);
        return tx.gasprice;
    }

    function fetchRandomnessAfter(uint256 blockNumber) external view override returns (bytes32) {
        require(_randomizedBlocks[blockNumber] != bytes32(0), "Randomness not yet available");
        return _randomizedBlocks[blockNumber];
    }

    function isRandomized(uint256 blockNumber) external view override returns (bool) {
        return _randomizedBlocks[blockNumber] != bytes32(0);
    }

    // ============ Test helpers ============

    /// @notice Simulate the oracle fulfilling randomness for a specific block
    function fulfillBlock(uint256 blockNumber) external {
        _randomizedBlocks[blockNumber] = mockRandomWord;
        emit RandomnessFulfilled(blockNumber, mockRandomWord);
    }

    /// @notice Fulfill with a specific random value
    function fulfillBlockWithValue(uint256 blockNumber, bytes32 randomWord) external {
        _randomizedBlocks[blockNumber] = randomWord;
        emit RandomnessFulfilled(blockNumber, randomWord);
    }

    /// @notice Set the default mock random word
    function setMockRandomWord(bytes32 word) external {
        mockRandomWord = word;
    }
}
