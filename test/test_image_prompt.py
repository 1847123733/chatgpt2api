from __future__ import annotations

import unittest

from services.protocol.conversation import build_image_prompt


class ImagePromptTests(unittest.TestCase):
    def test_custom_dimensions_add_ratio_and_target_size(self):
        prompt = build_image_prompt("画一张横幅", "1980x980")

        self.assertIn("画一张横幅", prompt)
        self.assertIn("宽高比接近 99:49", prompt)
        self.assertIn("目标画布尺寸为 1980x980 像素", prompt)

    def test_custom_ratio_keeps_ratio_hint(self):
        prompt = build_image_prompt("画一张横幅", "99:49")

        self.assertIn("宽高比为 99:49", prompt)


if __name__ == "__main__":
    unittest.main()
