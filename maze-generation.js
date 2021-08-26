const FOUR_WAY = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const EIGHT_WAY = FOUR_WAY.concat([
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
]);
const black_pixel_generator = get_next_black_pixel();
let start_time = new Date();
const FPS_TARGET = 60;
const SCALE = 1.7;
const COLOR_CHANGE_RATE = 200000;
const WIDTH = window.innerWidth / SCALE;
const HEIGHT = window.innerHeight / SCALE;
let x = Math.floor(WIDTH / 2);
let y = Math.floor(HEIGHT / 2);
let iterations_per_frame = 10000;
let iteration = Math.round(Math.random() * COLOR_CHANGE_RATE);
let RGB_RATES = [Math.random() * 5, Math.random() * 5, Math.random() * 5];
let canvas, ctx, img;

const initialize_canvas_and_draw = () => {
  canvas = document.getElementById("canvas");
  ctx = canvas.getContext("2d");
  ctx.canvas.width = WIDTH;
  ctx.canvas.height = HEIGHT;
  img = ctx.createImageData(WIDTH, HEIGHT);
  window.requestAnimationFrame(draw); // Start drawing
};

window.addEventListener("DOMContentLoaded", initialize_canvas_and_draw);

function draw() {
  // the brains of the operation
  for (let i = 0; i < iterations_per_frame; i++) {
    let candidates = get_next_move_candidates(x, y);
    let direction = candidates.length ? candidates : [...EIGHT_WAY];
    let [dx, dy] = direction[Math.floor(Math.random() * direction.length)];
    [x, y] = clamped_move(x, y, dx, dy);
    if (candidates.length) {
      let color = color_function(iteration);
      set_pixel(x, y, color);
      set_pixel(...clamped_move(x, y, -dx, -dy), color);
      iterations_since_last_candidate = 0;
    } else {
      iterations_since_last_candidate += 1;
    }
    if (iterations_since_last_candidate > iterations_per_frame) {
      iterations_since_last_candidate = 0;
      let black_pixel = black_pixel_generator.next();
      if (!black_pixel.done) {
        [x, y] = black_pixel.value;
        set_pixel(x, y, color_function(iteration));
      } else {
        console.log(
          "completed in " +
            (new Date().getTime() - start_time.getTime()) / 1000 +
            "s"
        );
        return;
      }
    }
    iteration++;
  }
  ctx.putImageData(img, 0, 0);
  tune_iterations_per_frame();
  window.requestAnimationFrame(draw);
}

// helper functions
function get_next_move_candidates(x, y) {
  return FOUR_WAY.filter((d1) => {
    let [x2, y2] = clamped_move(x, y, d1[0], d1[1]);
    return (
      !get_pixel(x2, y2) &&
      EIGHT_WAY.every((d2) => {
        if (d1[0] ? d2[0] == -d1[0] : d2[1] == -d1[1]) {
          return true;
        }
        return !get_pixel(x2 + d2[0], y2 + d2[1]);
      })
    );
  });
}
function* get_next_black_pixel() {
  let pixel_found = true;
  while (pixel_found) {
    pixel_found = false;
    for (let y = 0; y < ctx.canvas.height; y += 1) {
      for (let x = 0; x < ctx.canvas.width; x += 1) {
        if (!get_pixel(x, y) && get_next_move_candidates(x, y).length) {
          pixel_found = true;
          yield [x, y];
        }
      }
    }
  }
}
function* enumerate(array) {
  for (let i = 0; i < array.length; i += 1) {
    yield [i, array[i]];
  }
}
function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}
function clamped_move(x, y, dx, dy) {
  return [
    clamp(x + dx, 0, ctx.canvas.width - 1),
    clamp(y + dy, 0, ctx.canvas.height - 1),
  ];
}
function get_offset(x, y) {
  return y * ctx.canvas.width * 4 + x * 4;
}
function set_pixel(x, y, color) {
  for (let c of enumerate(color)) {
    img.data[get_offset(x, y) + c[0]] = c[1];
  }
}
function get_pixel(x, y) {
  return img.data[get_offset(x, y)];
}
function tune_iterations_per_frame() {
  new Promise((resolve) =>
    requestAnimationFrame((t1) =>
      requestAnimationFrame((t2) => resolve(1000 / (t2 - t1)))
    )
  ).then((fps) => {
    if (fps < FPS_TARGET) {
      iterations_per_frame *= 0.995;
    } else {
      iterations_per_frame *= 1.005;
    }
  });
}
function color_function(n) {
  return [
    127 + Math.floor(Math.sin((n / COLOR_CHANGE_RATE) * RGB_RATES[0]) * 80),
    127 + Math.floor(Math.sin((n / COLOR_CHANGE_RATE) * RGB_RATES[1]) * 80),
    127 + Math.floor(Math.sin((n / COLOR_CHANGE_RATE) * RGB_RATES[2]) * 80),
    255,
  ];
}
