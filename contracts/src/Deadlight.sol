// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Deadlight — a censorship-resistant dead man's switch.
/// @notice A publisher seals a document: the AES-GCM ciphertext lives entirely
///         on this contract (no server, no pin, nothing to seize), while the
///         decryption key is Shamir-split into `n` shares held off-chain by
///         guardians. Only the *commitments* to those shares are published here.
///
///         While the publisher is free, they send a `heartbeat` and the deadline
///         rolls forward. The contract refuses every share submission during that
///         window, so guardians cannot leak the document early even if they
///         collude — the chain itself enforces the embargo.
///
///         The moment the publisher goes silent — arrested, coerced, deplatformed,
///         dead — the deadline lapses and share submission opens to anyone. Once
///         `threshold` valid shares are on-chain, the key reconstructs in any
///         reader's browser and the document decrypts for the world.
///
///         Silencing the author is what publishes the document.
contract Deadlight {
    /*//////////////////////////////////////////////////////////////
                                 TYPES
    //////////////////////////////////////////////////////////////*/

    struct Vault {
        address publisher; // who armed the switch
        uint64 deadline; // unix ts; silence past this point opens the vault
        uint32 interval; // seconds each heartbeat buys
        uint8 threshold; // k — shares needed to reconstruct
        uint8 shareCount; // n — shares handed to guardians
        uint8 revealedCount; // how many distinct valid shares are on-chain
        bool revoked; // publisher stood down; vault can never open
        uint64 armedAt;
        uint64 lastHeartbeat;
        string title; // public: what the world is waiting on
        string mimeType;
        bytes iv; // AES-GCM nonce (12 bytes), public by design
        bytes ciphertext; // the document itself, on-chain
        bytes32[] shareCommits; // keccak256(share) for each guardian
    }

    /// @dev vault id => share index => the revealed share preimage
    mapping(uint256 => mapping(uint8 => bytes)) private _shares;
    /// @dev vault id => share index => already revealed?
    mapping(uint256 => mapping(uint8 => bool)) private _revealed;

    Vault[] private _vaults;

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    event VaultArmed(
        uint256 indexed id,
        address indexed publisher,
        string title,
        uint8 threshold,
        uint8 shareCount,
        uint64 deadline
    );
    event Heartbeat(uint256 indexed id, address indexed publisher, uint64 newDeadline);
    event ShareRevealed(uint256 indexed id, uint8 indexed index, address indexed submitter, uint8 revealedCount);
    event Unlocked(uint256 indexed id, uint64 at);
    event Revoked(uint256 indexed id);

    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    error NotPublisher();
    error VaultRevoked();
    error DeadlineLapsed();
    error StillAlive(uint64 deadline);
    error BadThreshold();
    error NoCiphertext();
    error BadIv();
    error IndexOutOfRange();
    error AlreadyRevealed();
    error ShareMismatch();
    error UnknownVault();

    /*//////////////////////////////////////////////////////////////
                                  ARM
    //////////////////////////////////////////////////////////////*/

    /// @notice Seal a document and start the clock.
    /// @param title Public label — the world can see *that* something is sealed.
    /// @param mimeType MIME type used to render the plaintext once it opens.
    /// @param iv 12-byte AES-GCM nonce.
    /// @param ciphertext AES-GCM ciphertext of the document. Stored on-chain.
    /// @param shareCommits keccak256 of each Shamir share (33 bytes: x ‖ y[32]).
    /// @param threshold How many shares reconstruct the key. 1 <= k <= n.
    /// @param interval Seconds each heartbeat buys. Also sets the first deadline.
    function arm(
        string calldata title,
        string calldata mimeType,
        bytes calldata iv,
        bytes calldata ciphertext,
        bytes32[] calldata shareCommits,
        uint8 threshold,
        uint32 interval
    ) external returns (uint256 id) {
        if (ciphertext.length == 0) revert NoCiphertext();
        if (iv.length != 12) revert BadIv();
        uint256 n = shareCommits.length;
        if (n == 0 || n > 255 || threshold == 0 || threshold > n) revert BadThreshold();
        if (interval == 0) revert BadThreshold();

        id = _vaults.length;
        Vault storage v = _vaults.push();
        v.publisher = msg.sender;
        v.deadline = uint64(block.timestamp) + interval;
        v.interval = interval;
        v.threshold = threshold;
        v.shareCount = uint8(n);
        v.armedAt = uint64(block.timestamp);
        v.lastHeartbeat = uint64(block.timestamp);
        v.title = title;
        v.mimeType = mimeType;
        v.iv = iv;
        v.ciphertext = ciphertext;
        v.shareCommits = shareCommits;

        emit VaultArmed(id, msg.sender, title, threshold, uint8(n), v.deadline);
    }

    /*//////////////////////////////////////////////////////////////
                               STAY ALIVE
    //////////////////////////////////////////////////////////////*/

    /// @notice Prove you are still free. Rolls the deadline forward by `interval`.
    /// @dev Deliberately unavailable once the deadline lapses: a publisher under
    ///      duress cannot be forced to "un-publish" by a late check-in, and a
    ///      captor who seizes the key cannot re-arm the switch to bury the leak.
    function heartbeat(uint256 id) external {
        Vault storage v = _vault(id);
        if (msg.sender != v.publisher) revert NotPublisher();
        if (v.revoked) revert VaultRevoked();
        if (block.timestamp >= v.deadline) revert DeadlineLapsed();

        v.deadline = uint64(block.timestamp) + v.interval;
        v.lastHeartbeat = uint64(block.timestamp);
        emit Heartbeat(id, msg.sender, v.deadline);
    }

    /// @notice Stand down while still free — the vault can never open.
    /// @dev Self-sovereignty: the author keeps the right to withdraw their own
    ///      words, but only from a position of freedom, never after the lapse.
    function revoke(uint256 id) external {
        Vault storage v = _vault(id);
        if (msg.sender != v.publisher) revert NotPublisher();
        if (block.timestamp >= v.deadline) revert DeadlineLapsed();
        v.revoked = true;
        emit Revoked(id);
    }

    /*//////////////////////////////////////////////////////////////
                              THE RELEASE
    //////////////////////////////////////////////////////////////*/

    /// @notice Publish a guardian share. Permissionless by design: the commitment
    ///         check is the only gate, so a guardian who is themselves silenced
    ///         can hand their share to anyone and the release still happens.
    function submitShare(uint256 id, uint8 index, bytes calldata share) external {
        Vault storage v = _vault(id);
        if (v.revoked) revert VaultRevoked();
        if (block.timestamp < v.deadline) revert StillAlive(v.deadline);
        if (index >= v.shareCount) revert IndexOutOfRange();
        if (_revealed[id][index]) revert AlreadyRevealed();
        if (keccak256(share) != v.shareCommits[index]) revert ShareMismatch();

        _revealed[id][index] = true;
        _shares[id][index] = share;
        uint8 count = ++v.revealedCount;

        emit ShareRevealed(id, index, msg.sender, count);
        if (count == v.threshold) emit Unlocked(id, uint64(block.timestamp));
    }

    /*//////////////////////////////////////////////////////////////
                                  VIEWS
    //////////////////////////////////////////////////////////////*/

    function vaultCount() external view returns (uint256) {
        return _vaults.length;
    }

    /// @notice Everything a reader needs except the ciphertext (fetched separately
    ///         so wallets and explorers do not choke on large documents).
    function vaultInfo(uint256 id)
        external
        view
        returns (
            address publisher,
            uint64 deadline,
            uint32 interval,
            uint8 threshold,
            uint8 shareCount,
            uint8 revealedCount,
            bool revoked,
            bool unlocked,
            uint64 armedAt,
            uint64 lastHeartbeat,
            string memory title,
            string memory mimeType,
            uint256 ciphertextLength
        )
    {
        Vault storage v = _vault(id);
        return (
            v.publisher,
            v.deadline,
            v.interval,
            v.threshold,
            v.shareCount,
            v.revealedCount,
            v.revoked,
            !v.revoked && v.revealedCount >= v.threshold,
            v.armedAt,
            v.lastHeartbeat,
            v.title,
            v.mimeType,
            v.ciphertext.length
        );
    }

    function ciphertextOf(uint256 id) external view returns (bytes memory iv, bytes memory ciphertext) {
        Vault storage v = _vault(id);
        return (v.iv, v.ciphertext);
    }

    function commitmentsOf(uint256 id) external view returns (bytes32[] memory) {
        return _vault(id).shareCommits;
    }

    /// @notice Revealed shares, in index order. Empty entries are still sealed.
    function revealedShares(uint256 id) external view returns (uint8[] memory indices, bytes[] memory shares) {
        Vault storage v = _vault(id);
        uint8 n = v.shareCount;
        uint8 got = v.revealedCount;
        indices = new uint8[](got);
        shares = new bytes[](got);
        uint8 w;
        for (uint8 i; i < n; ++i) {
            if (_revealed[id][i]) {
                indices[w] = i;
                shares[w] = _shares[id][i];
                unchecked {
                    ++w;
                }
            }
        }
    }

    /// @notice True once the world can read it.
    function isUnlocked(uint256 id) external view returns (bool) {
        Vault storage v = _vault(id);
        return !v.revoked && v.revealedCount >= v.threshold;
    }

    /// @notice Seconds of silence remaining before the vault opens. 0 = lapsed.
    function timeRemaining(uint256 id) external view returns (uint64) {
        Vault storage v = _vault(id);
        if (block.timestamp >= v.deadline) return 0;
        return v.deadline - uint64(block.timestamp);
    }

    function _vault(uint256 id) private view returns (Vault storage) {
        if (id >= _vaults.length) revert UnknownVault();
        return _vaults[id];
    }
}
