import * as po from "./pixel-operations.js";

const canvas = document.getElementById("canvas");
let WIDTH = window.innerWidth / 2;
let HEIGHT = window.innerHeight / 2;
let Grid = new po.InfiniteGrid(canvas, WIDTH, HEIGHT);
let center_offset = new po.Pixel(
  -Grid.img_width / 2 + WIDTH / 2,
  -Grid.img_height / 2 + HEIGHT / 2
);

function draw() {
  for (let _ of [...Array(5).keys()]) {
    Grid.set_pixel(
      Math.floor(Math.random() * Grid.img_width),
      Math.floor(Math.random() * Grid.img_height),
      [255, 255, 255, Math.floor(Math.random() * 255)]
    );
  }
  Grid.update(center_offset);
  window.requestAnimationFrame(draw);
}

// events
window.addEventListener("DOMContentLoaded", () => {
  window.requestAnimationFrame(draw); // Start drawing
});
// dragging controls
(() => {
  let drag_offset = null;
  window.addEventListener("mousedown", ({ x, y }) => {
    drag_offset = new po.Pixel(x, y);
  });
  window.addEventListener("touchstart", ({ changedTouches }) => {
    let x = changedTouches[0].screenX;
    let y = changedTouches[0].screenY;
    drag_offset = new po.Pixel(x, y);
  });
  window.addEventListener("mousemove", ({ buttons, x, y }) => {
    if (!buttons & 1 || !drag_offset) {
      // primary mouse not pressed
      return;
    }
    center_offset.add(x - drag_offset.x, y - drag_offset.y);
    drag_offset = new po.Pixel(x, y);
  });
  window.addEventListener("touchmove", ({ changedTouches }) => {
    let x = changedTouches[0].screenX;
    let y = changedTouches[0].screenY;
    if (!drag_offset) {
      // primary mouse not pressed
      return;
    }
    center_offset.add(x - drag_offset.x, y - drag_offset.y);
    drag_offset = new po.Pixel(x, y);
  });
})();
