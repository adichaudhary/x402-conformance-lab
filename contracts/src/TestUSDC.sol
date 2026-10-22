// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @title TestUSDC
/// @notice USDC-compatible token for the local Anvil chain. Implements the parts of EIP-3009
///         that the x402 exact EVM scheme uses: transferWithAuthorization (in both the v/r/s
///         and bytes signature forms) and authorizationState.
/// @dev Test only: anyone can mint. Never deploy this to a real network.
contract TestUSDC is ERC20, EIP712 {
    // ---------------------------------------------------------------------------------------
    // 4a. Identity: name, symbol, decimals, version
    // ---------------------------------------------------------------------------------------

    /// @dev ERC20("USDC", "USDC") sets name() and symbol().
    ///      EIP712("USDC", "2") sets the signing domain. Both must match the `extra.name` and
    ///      `extra.version` that servers advertise, or every signature check fails.
    constructor() ERC20("USDC", "USDC") EIP712("USDC", "2") {}

    /// @notice 6 decimals, like real USDC. "10000" atomic units = 0.01 USDC.
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice EIP-712 domain version. Real USDC returns "2" here too.
    function version() external pure returns (string memory) {
        return "2";
    }

    /// @notice Creates test tokens. Open to anyone because this only runs on a local chain.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    // ---------------------------------------------------------------------------------------
    // 4b. EIP-3009 state: the typehash, used nonces, and read functions
    // ---------------------------------------------------------------------------------------

    /// @notice Hash of the struct the payer signs. The field order must match x402's
    ///         `authorizationTypes`, or the payer and the contract hash different messages.
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    /// @dev authorizer => nonce => already used. This is the "cashed checks" ledger.
    mapping(address authorizer => mapping(bytes32 nonce => bool used)) private _authorizationStates;

    /// @notice Emitted when an authorization is consumed.
    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);

    /// @notice True if `nonce` has already been used by `authorizer`.
    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool) {
        return _authorizationStates[authorizer][nonce];
    }

    /// @notice The EIP-712 domain separator: hash of (name, version, chainId, this address).
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ---------------------------------------------------------------------------------------
    // 4c. The rules. Both entry points end up here, so the checks exist in one place only.
    // ---------------------------------------------------------------------------------------

    /// @dev Revert strings match real USDC's wording. The x402 facilitator matches on them to
    ///      pick an error code (for example invalid_exact_evm_payload_authorization_valid_before).
    function _transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes memory signature
    ) private {
        // 1-2. The check is only cashable inside its time window.
        require(block.timestamp > validAfter, "authorization is not yet valid");
        require(block.timestamp < validBefore, "authorization is expired");

        // 3. Each check number works once.
        require(!_authorizationStates[from][nonce], "authorization is used or canceled");

        // 4. Rebuild the exact digest the payer signed: struct hash wrapped in the domain.
        bytes32 structHash = keccak256(
            abi.encode(TRANSFER_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce)
        );
        bytes32 digest = _hashTypedDataV4(structHash);

        // 5. The signature must come from `from`. Changing any field above changes the
        //    digest, so a tampered amount or recipient fails here.
        require(SignatureChecker.isValidSignatureNow(from, digest, signature), "invalid signature");

        // 6. Stamp the check as cashed before moving money.
        _authorizationStates[from][nonce] = true;
        emit AuthorizationUsed(from, nonce);

        // 7. Move the tokens. Emits the standard ERC-20 Transfer event the facilitator checks.
        _transfer(from, to, value);
    }

    // ---------------------------------------------------------------------------------------
    // 4d. Public entry points. Same name, two signature formats.
    // ---------------------------------------------------------------------------------------

    /// @notice Signature split into v, r, s. The x402 facilitator calls this form for
    ///         ordinary 65-byte wallet signatures.
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        _transferWithAuthorization(from, to, value, validAfter, validBefore, nonce, abi.encodePacked(r, s, v));
    }

    /// @notice Signature as raw bytes. The facilitator calls this form for any other length,
    ///         such as smart-contract wallet (ERC-1271) signatures.
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes memory signature
    ) external {
        _transferWithAuthorization(from, to, value, validAfter, validBefore, nonce, signature);
    }
}
