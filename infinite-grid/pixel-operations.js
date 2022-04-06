function* enumerate(array) {
  for (let i = 0; i < array.length; i += 1) {
    yield [i, array[i]];
  }
}

export class Pixel {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }

  add(x, y) {
    this.x += x;
    this.y += y;
  }
}

export class InfiniteGrid {
  constructor(canvas, width, height) {
    this.ctx = canvas.getContext("2d");
    this.width = width;
    this.height = height;
    this.img_width = width * 10;
    this.img_height = height * 10;
    this.ctx.canvas.width = width;
    this.ctx.canvas.height = height;
    this.img = this.ctx.createImageData(this.img_width, this.img_height);
  }

  set_pixel(x, y, color) {
    for (let c of enumerate(color)) {
      this.img.data[y * this.img_width * 4 + x * 4 + c[0]] = c[1];
    }
  }

  get_pixel(x, y) {
    return this.img.data[y * this.img_width * 4 + x * 4];
  }

  update(center_point) {
    this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
    this.ctx.putImageData(this.img, center_point.x, center_point.y);
  }
}
