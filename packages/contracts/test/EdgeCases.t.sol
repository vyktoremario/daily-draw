// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {DailyDraw} from "../src/DailyDraw.sol";
import {IRandomnessProvider} from "../src/interfaces/IRandomnessProvider.sol";
import {DailyDrawBase} from "./DailyDrawBase.sol";

/// @notice Input checks not covered elsewhere, so every line of DailyDraw.sol is exercised (#28).
contract EdgeCasesTest is DailyDrawBase {
    function initWith(
        address admin_,
        address timelock_,
        IERC20 usdc_,
        IRandomnessProvider rng_,
        address treasury_,
        address buyback_,
        uint64 cutoff
    ) internal returns (bool ok) {
        address impl = address(new DailyDraw());
        bytes memory init = abi.encodeCall(
            DailyDraw.initialize,
            (admin_, timelock_, usdc_, rng_, treasury_, buyback_, defaultParams(), cutoff)
        );
        try new ERC1967Proxy(impl, init) {
            ok = true;
        } catch (bytes memory reason) {
            assertEq(bytes4(reason), DailyDraw.InvalidParams.selector);
        }
    }

    function test_InitializeRejectsZeroAddresses() public {
        assertTrue(initWith(admin, admin, usdc, rng, treasury, buyback, firstCutoff)); // control
        assertFalse(initWith(admin, admin, IERC20(address(0)), rng, treasury, buyback, firstCutoff));
        assertFalse(
            initWith(
                admin, admin, usdc, IRandomnessProvider(address(0)), treasury, buyback, firstCutoff
            )
        );
        assertFalse(initWith(address(0), admin, usdc, rng, treasury, buyback, firstCutoff));
        assertFalse(initWith(admin, address(0), usdc, rng, treasury, buyback, firstCutoff));
        assertFalse(initWith(admin, admin, usdc, rng, address(0), buyback, firstCutoff));
        assertFalse(initWith(admin, admin, usdc, rng, treasury, address(0), firstCutoff));
    }

    function test_InitializeRejectsACutoffNotInTheFuture() public {
        assertFalse(initWith(admin, admin, usdc, rng, treasury, buyback, uint64(block.timestamp)));
        assertFalse(
            initWith(admin, admin, usdc, rng, treasury, buyback, uint64(block.timestamp - 1))
        );
        assertTrue(
            initWith(admin, admin, usdc, rng, treasury, buyback, uint64(block.timestamp + 1))
        );
    }

    function test_RevertWhen_ClosingADrawThatIsNotOpen() public {
        uint256 drawId = closeAndDraw(7);
        vm.expectRevert(abi.encodeWithSelector(DailyDraw.DrawNotOpen.selector, drawId));
        game.closeDraw(drawId);
        // A draw that hasn't opened yet can't be closed either.
        uint256 future = game.currentDrawId() + 1;
        vm.expectRevert(abi.encodeWithSelector(DailyDraw.DrawNotOpen.selector, future));
        game.closeDraw(future);
    }

    function test_RevertWhen_SettingZeroBuybackReserve() public {
        vm.prank(admin);
        vm.expectRevert(DailyDraw.InvalidParams.selector);
        game.setBuybackReserve(address(0));
    }

    function test_RevertWhen_SettingZeroRandomnessProvider() public {
        vm.prank(admin); // the timelock in this setup
        vm.expectRevert(DailyDraw.InvalidParams.selector);
        game.setRandomnessProvider(IRandomnessProvider(address(0)));
    }
}
