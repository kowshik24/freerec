"""Render site/avatar.html into a looping .y4m file used as Chrome's fake webcam."""
import asyncio
import os
import shutil
import subprocess

import imageio_ffmpeg
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
FPS = 30
SECONDS = 8  # 4s sway/blink cycle x2, so the loop is seamless


async def _frames(out_dir):
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 640, "height": 480})
        await page.goto("file://" + os.path.join(HERE, "site", "avatar.html"))
        await page.evaluate("document.getAnimations().forEach(a => a.pause())")
        for i in range(FPS * SECONDS):
            await page.evaluate(f"document.getAnimations().forEach(a => a.currentTime = {i * 1000 / FPS})")
            await page.screenshot(path=os.path.join(out_dir, f"{i:04d}.png"))
        await browser.close()


def build_avatar(out_path):
    tmp = out_path + ".frames"
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp)
    asyncio.run(_frames(tmp))
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error", "-framerate", str(FPS),
                    "-i", os.path.join(tmp, "%04d.png"), "-pix_fmt", "yuv420p", out_path], check=True)
    shutil.rmtree(tmp)
    return out_path


if __name__ == "__main__":
    os.makedirs(os.path.join(HERE, "build"), exist_ok=True)
    print(build_avatar(os.path.join(HERE, "build", "avatar.y4m")))
