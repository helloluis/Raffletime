// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockVRFDispatcher
/// @notice Test double for VRFDispatcher. Captures requestRandomness() calls
///         and allows manual fulfillment for testnet/unit testing.
contract MockVRFDispatcher {
    mapping(uint256 => address) public pendingRequests;
    uint256 public nextRequestId = 1;

    event RandomnessRequested(uint256 indexed requestId, address indexed vault);

    function authorizeVault(address) external {
        // no-op — all vaults are trusted in mock
    }

    function requestRandomness(address vault) external returns (uint256 requestId) {
        requestId = nextRequestId++;
        pendingRequests[requestId] = vault;
        emit RandomnessRequested(requestId, vault);
    }

    /// @notice Fulfill a pending request with a deterministic seed (testnet use).
    function fulfillRequest(uint256 requestId) external {
        _fulfill(requestId, uint256(keccak256(abi.encode(requestId, block.timestamp))));
    }

    /// @notice Fulfill with a specific random value.
    function fulfillRequestWithValue(uint256 requestId, uint256 randomWord) external {
        _fulfill(requestId, randomWord);
    }

    function _fulfill(uint256 requestId, uint256 seed) internal {
        address vault = pendingRequests[requestId];
        require(vault != address(0), "Unknown requestId");
        delete pendingRequests[requestId];
        (bool ok,) = vault.call(abi.encodeWithSignature("receiveRandomness(uint256)", seed));
        require(ok, "receiveRandomness failed");
    }
}
