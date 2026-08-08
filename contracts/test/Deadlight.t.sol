// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Deadlight} from "../src/Deadlight.sol";

contract DeadlightTest is Test {
    Deadlight dl;

    address publisher = address(0xA11CE);
    address guardian = address(0xB0B);
    address stranger = address(0xCAFE);

    bytes iv = hex"000102030405060708090a0b";
    bytes ct = hex"deadbeefdeadbeefdeadbeef";

    bytes share0 = hex"01aabbcc";
    bytes share1 = hex"02ddeeff";
    bytes share2 = hex"03445566";

    function setUp() public {
        dl = new Deadlight();
        vm.warp(1_000_000);
    }

    function _commits() internal view returns (bytes32[] memory c) {
        c = new bytes32[](3);
        c[0] = keccak256(share0);
        c[1] = keccak256(share1);
        c[2] = keccak256(share2);
    }

    function _arm() internal returns (uint256 id) {
        vm.prank(publisher);
        id = dl.arm("Ledger of payments", "text/plain", iv, ct, _commits(), 2, 1 hours);
    }

    function test_ArmSetsDeadlineAndState() public {
        uint256 id = _arm();
        (,uint64 deadline,, uint8 threshold, uint8 n,,, bool unlocked,,,,, uint256 ctLen) = dl.vaultInfo(id);
        assertEq(deadline, uint64(block.timestamp + 1 hours));
        assertEq(threshold, 2);
        assertEq(n, 3);
        assertFalse(unlocked);
        assertEq(ctLen, ct.length);
    }

    /// The embargo is the whole point: colluding guardians cannot open it early.
    function test_SharesRejectedWhilePublisherAlive() public {
        uint256 id = _arm();
        vm.prank(guardian);
        vm.expectRevert(abi.encodeWithSelector(Deadlight.StillAlive.selector, uint64(block.timestamp + 1 hours)));
        dl.submitShare(id, 0, share0);
    }

    function test_HeartbeatRollsDeadlineForward() public {
        uint256 id = _arm();
        skip(30 minutes);
        vm.prank(publisher);
        dl.heartbeat(id);
        (, uint64 deadline,,,,,,,,,,,) = dl.vaultInfo(id);
        assertEq(deadline, uint64(block.timestamp + 1 hours));
    }

    function test_OnlyPublisherHeartbeats() public {
        uint256 id = _arm();
        vm.prank(stranger);
        vm.expectRevert(Deadlight.NotPublisher.selector);
        dl.heartbeat(id);
    }

    /// A captor who seizes the key after the lapse must not be able to bury the leak.
    function test_HeartbeatUselessAfterLapse() public {
        uint256 id = _arm();
        skip(1 hours + 1);
        vm.prank(publisher);
        vm.expectRevert(Deadlight.DeadlineLapsed.selector);
        dl.heartbeat(id);
    }

    function test_SilenceUnlocksAtThreshold() public {
        uint256 id = _arm();
        skip(1 hours + 1);

        vm.prank(guardian);
        dl.submitShare(id, 0, share0);
        assertFalse(dl.isUnlocked(id));

        // Permissionless: a guardian can pass their share to anyone.
        vm.prank(stranger);
        dl.submitShare(id, 1, share1);
        assertTrue(dl.isUnlocked(id));

        (uint8[] memory idx, bytes[] memory got) = dl.revealedShares(id);
        assertEq(idx.length, 2);
        assertEq(got[0], share0);
        assertEq(got[1], share1);
    }

    function test_ForgedShareRejected() public {
        uint256 id = _arm();
        skip(1 hours + 1);
        vm.prank(stranger);
        vm.expectRevert(Deadlight.ShareMismatch.selector);
        dl.submitShare(id, 0, hex"01ffffff");
    }

    function test_ShareCannotBeReplayed() public {
        uint256 id = _arm();
        skip(1 hours + 1);
        vm.prank(guardian);
        dl.submitShare(id, 0, share0);
        vm.prank(guardian);
        vm.expectRevert(Deadlight.AlreadyRevealed.selector);
        dl.submitShare(id, 0, share0);
    }

    function test_RevokeSealsForever() public {
        uint256 id = _arm();
        vm.prank(publisher);
        dl.revoke(id);
        skip(1 hours + 1);
        vm.prank(guardian);
        vm.expectRevert(Deadlight.VaultRevoked.selector);
        dl.submitShare(id, 0, share0);
        assertFalse(dl.isUnlocked(id));
    }

    function test_CannotRevokeAfterLapse() public {
        uint256 id = _arm();
        skip(1 hours + 1);
        vm.prank(publisher);
        vm.expectRevert(Deadlight.DeadlineLapsed.selector);
        dl.revoke(id);
    }

    function test_RejectsBadThreshold() public {
        bytes32[] memory c = _commits();
        vm.prank(publisher);
        vm.expectRevert(Deadlight.BadThreshold.selector);
        dl.arm("x", "text/plain", iv, ct, c, 4, 1 hours); // k > n
    }

    function test_RejectsBadIv() public {
        vm.prank(publisher);
        vm.expectRevert(Deadlight.BadIv.selector);
        dl.arm("x", "text/plain", hex"0011", ct, _commits(), 2, 1 hours);
    }

    function testFuzz_TimeRemainingNeverUnderflows(uint32 jump) public {
        uint256 id = _arm();
        skip(jump);
        uint64 rem = dl.timeRemaining(id);
        assertLe(rem, 1 hours);
    }
}
