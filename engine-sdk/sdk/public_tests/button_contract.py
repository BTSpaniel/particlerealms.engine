# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
from unittest import TestCase

class PublicButtonContracts(TestCase):
    modes = ("source", "compiled")
    def test_real_mouse_dispatches_callback_and_retained_action_once(self):
        for mode in self.modes:
            with self.subTest(mode=mode), self.visit(mode) as page:
                page.click("#button-under-test")
                result = page.evaluate("fixture.snapshot()")
                self.assertEqual((result["clicks"], result["callbackCount"], result["activationCount"], result["defaults"]), (1, 1, 1, 1))
                self.assertEqual(result["callbacks"][0], {"type": "click", "correctTarget": True, "nativeMouse": True,
                    "nativePrevented": False, "prevented": False, "sameActivation": False})
                self.assertEqual(result["activations"][0], {"type": "button-click", "correctTarget": True,
                    "nativeMouse": True, "nativePrevented": False, "prevented": False})


    def test_mouse_callback_prevention_reaches_retained_and_native_events(self):
        self.check_mouse_cancellation("callback")


    def test_retained_prevention_reaches_native_mouse_event(self):
        self.check_mouse_cancellation("retained")


    def check_mouse_cancellation(self, cancellation):
        for mode in self.modes:
            with self.subTest(mode=mode), self.visit(mode) as page:
                page.evaluate("value => fixture.reset(value)", cancellation)
                page.click("#button-under-test")
                result = page.evaluate("fixture.snapshot()")
                self.assertEqual((result["clicks"], result["callbackCount"], result["activationCount"], result["defaults"]), (1, 1, 1, 0))
                self.assertTrue(result["callbacks"][0]["nativePrevented"])
                self.assertTrue(result["activations"][0]["prevented"])
                self.assertTrue(result["activations"][0]["nativePrevented"])


    def test_programmatic_activation_has_one_cancelable_public_callback(self):
        for mode in self.modes:
            with self.subTest(mode=mode), self.visit(mode) as page:
                for cancellation in (None, "callback", "retained"):
                    page.evaluate("value => {fixture.reset(value); fixture.button.activate();}", cancellation)
                    result = page.evaluate("fixture.snapshot()")
                    self.assertEqual((result["clicks"], result["callbackCount"], result["activationCount"]), (0, 1, 1))
                    self.assertEqual(result["defaults"], 1 if cancellation is None else 0)
                    self.assertTrue(result["callbacks"][0]["sameActivation"])
                    self.assertEqual(result["callbacks"][0]["type"], "button-click")
                    self.assertEqual(result["activations"][0]["prevented"], cancellation is not None)


    def test_disabled_and_loading_suppress_native_and_programmatic_actions(self):
        for mode in self.modes:
            with self.subTest(mode=mode), self.visit(mode) as page:
                for state in ("disabled", "loading"):
                    result = page.evaluate("""state => {
                        fixture.reset();
                        const button = fixture.button;
                        if (state === 'disabled') button.setDisabled(true); else button.setLoading(true);
                        fixture.renderer.updateNode(button);
                        const native = new MouseEvent('click', {bubbles:true, cancelable:true});
                        fixture.renderer.getDOMElement(button).dispatchEvent(native);
                        button.activate();
                        button.dispatchEvent({type:'keydown', key:'Enter', preventDefault(){}});
                        const result = {...fixture.snapshot(), nativePrevented:native.defaultPrevented};
                        if (state === 'disabled') button.setDisabled(false); else button.setLoading(false);
                        fixture.renderer.updateNode(button);
                        return result;
                    }""", state)
                    self.assertEqual((result["callbackCount"], result["activationCount"], result["defaults"]), (0, 0, 0))
                    self.assertTrue(result["nativePrevented"])
                    page.evaluate("fixture.reset()")
                    self.assertFalse(page.evaluate("fixture.renderer.getDOMElement(fixture.button).disabled"))
                    # The unchanged renderer retains aria-disabled after clearing
                    # native disabled. Exercise the actual user mouse path rather
                    # than Playwright's additional ARIA-based locator guard.
                    box = page.locator("#button-under-test").bounding_box()
                    self.assertIsNotNone(box)
                    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
                    self.assertEqual(page.evaluate("fixture.snapshot().defaults"), 1)


    def test_real_keyboard_enter_and_space_activate_once_without_extra_click(self):
        for mode in self.modes:
            with self.subTest(mode=mode), self.visit(mode) as page:
                page.focus("#button-under-test")
                for key, value in (("Enter", "Enter"), ("Space", " ")):
                    page.evaluate("fixture.reset()")
                    page.keyboard.press(key)
                    result = page.evaluate("fixture.snapshot()")
                    self.assertEqual((result["clicks"], result["callbackCount"], result["activationCount"], result["defaults"]), (0, 1, 1, 1))
                    self.assertEqual(result["keys"], [{"key": value, "prevented": True}])
                    self.assertTrue(result["callbacks"][0]["sameActivation"])
                page.evaluate("fixture.reset()")
                page.keyboard.press("ArrowRight")
                result = page.evaluate("fixture.snapshot()")
                self.assertEqual((result["callbackCount"], result["activationCount"], result["defaults"]), (0, 0, 0))
                self.assertEqual(result["keys"], [{"key": "ArrowRight", "prevented": False}])


    def test_retained_click_contract_preserves_prevention_without_redispatch(self):
        for mode in self.modes:
            with self.subTest(mode=mode), self.visit(mode) as page:
                result = page.evaluate("""() => {
                    fixture.reset('callback');
                    const event = {type:'click', target:fixture.button, defaultPrevented:false,
                        preventDefault(){this.defaultPrevented = true;}};
                    const accepted = fixture.button.dispatchEvent(event);
                    return {...fixture.snapshot(), accepted, eventPrevented:event.defaultPrevented};
                }""")
                self.assertEqual((result["clicks"], result["callbackCount"], result["activationCount"], result["defaults"]), (1, 1, 1, 0))
                self.assertFalse(result["accepted"])
                self.assertTrue(result["eventPrevented"])
                self.assertTrue(result["activations"][0]["prevented"])


