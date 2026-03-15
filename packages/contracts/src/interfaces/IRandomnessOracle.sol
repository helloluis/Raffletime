// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IRandomnessOracle
/// @notice Generic interface for on-chain randomness providers.
///         Uses a two-step pull model: request randomness, then fetch it later.
///         Compatible with Witnet Randomness Oracle on Celo
///         (0xC0FFEE98AD1434aCbDB894BbB752e138c1006fAB on mainnet + testnet).
interface IRandomnessOracle {
    /// @notice Request new randomness. Must send enough native token to cover the fee.
    function randomize() external payable returns (uint256);

    /// @notice Estimate the fee needed for a randomize() call at the given gas price.
    function estimateRandomizeFee(uint256 evmGasPrice) external view returns (uint256);

    /// @notice Fetch the randomness generated after a given block number.
    ///         Reverts if randomness is not yet available.
    function fetchRandomnessAfter(uint256 blockNumber) external view returns (bytes32);

    /// @notice Check if a block has been randomized yet.
    function isRandomized(uint256 blockNumber) external view returns (bool);
}
