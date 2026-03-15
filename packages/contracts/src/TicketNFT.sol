// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/Base64.sol";

/// @title TicketNFT
/// @notice ERC-721 ticket for RaffleTime raffles. Each ticket records the raffle,
///         ticket number, beneficiary vote, and purchase timestamp. Minted by RaffleVault only.
contract TicketNFT is ERC721, Ownable {
    using Strings for uint256;
    using Strings for address;

    uint256 private _nextTokenId = 1;

    struct TicketData {
        address raffle;
        uint256 ticketNumber;
        address beneficiaryVote;
        uint256 purchasedAt;
    }

    /// @notice Ticket metadata by token ID
    mapping(uint256 => TicketData) private _tickets;

    /// @notice Authorized minters (RaffleVault contracts)
    mapping(address => bool) public authorizedMinters;

    event MinterAuthorized(address indexed minter);
    event MinterRevoked(address indexed minter);

    modifier onlyMinter() {
        require(authorizedMinters[msg.sender], "Not authorized minter");
        _;
    }

    constructor() ERC721("RaffleTime Ticket", "RTT") Ownable(msg.sender) {}

    /// @notice Authorize a RaffleVault to mint tickets
    function authorizeMinter(address minter) external onlyOwner {
        authorizedMinters[minter] = true;
        emit MinterAuthorized(minter);
    }

    /// @notice Revoke minting authorization
    function revokeMinter(address minter) external onlyOwner {
        authorizedMinters[minter] = false;
        emit MinterRevoked(minter);
    }

    /// @notice Mint a ticket NFT to a participant. Called by RaffleVault on entry.
    /// @param to The participant address
    /// @param raffle The raffle vault address
    /// @param ticketNumber The assigned ticket number
    /// @param beneficiaryVote The beneficiary the participant voted for
    /// @return tokenId The minted token ID
    function mint(address to, address raffle, uint256 ticketNumber, address beneficiaryVote)
        external
        onlyMinter
        returns (uint256 tokenId)
    {
        tokenId = _nextTokenId++;
        _mint(to, tokenId);

        _tickets[tokenId] = TicketData({
            raffle: raffle,
            ticketNumber: ticketNumber,
            beneficiaryVote: beneficiaryVote,
            purchasedAt: block.timestamp
        });
    }

    /// @notice Get ticket data
    function getTicket(uint256 tokenId) external view returns (TicketData memory) {
        require(tokenId > 0 && tokenId < _nextTokenId, "Invalid token ID");
        return _tickets[tokenId];
    }

    /// @notice On-chain JSON metadata
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(tokenId > 0 && tokenId < _nextTokenId, "Invalid token ID");
        TicketData memory ticket = _tickets[tokenId];

        string memory json = string(
            abi.encodePacked(
                '{"name":"RaffleTime Ticket #',
                tokenId.toString(),
                '","description":"Raffle ticket for RaffleTime","attributes":[{"trait_type":"Raffle","value":"',
                Strings.toHexString(ticket.raffle),
                '"},{"trait_type":"Ticket Number","value":"',
                ticket.ticketNumber.toString(),
                '"},{"trait_type":"Beneficiary Vote","value":"',
                Strings.toHexString(ticket.beneficiaryVote),
                '"},{"trait_type":"Purchased At","value":"',
                ticket.purchasedAt.toString(),
                '"}]}'
            )
        );

        return string(abi.encodePacked("data:application/json;base64,", Base64.encode(bytes(json))));
    }

    function totalTickets() external view returns (uint256) {
        return _nextTokenId - 1;
    }
}
