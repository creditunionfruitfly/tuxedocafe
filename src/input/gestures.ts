import controls from '../../data/interaction.json' with { type: 'json' };
export type Gesture = 'hover' | 'menu' | 'stroke' | 'hold' | 'radial' | 'walk' | 'look' | 'move';
export type TargetKind = 'floor' | 'object' | 'cat' | 'none';
export class Gestures {
  state: Gesture = 'hover'; down = false; elapsed = 0; moved = 0; target: TargetKind = 'none'; toggle = false; holdMs = 250;
  press(target: TargetKind, right = false, fingers = 1): Gesture {
    if (this.toggle && this.state === 'hold') { this.down = false; return this.state = 'hover'; }
    this.down = true; this.target = target; this.elapsed = 0; this.moved = 0;
    // Right-drag looks; a second finger turns the gesture into a walking stick.
    return this.state = right ? 'look' : fingers > 1 ? 'move' : this.toggle && target === 'object' ? 'hold' : 'hover';
  }
  move(distance: number, fingers = 1): Gesture {
    this.moved = Math.max(this.moved,distance);
    if (fingers > 1) return this.state = 'move';
    if (this.down && this.moved > controls.dragThresholdPx && this.state !== 'look' && this.state !== 'move') this.state = this.target === 'object' ? 'hold' : this.target === 'cat' ? 'stroke' : 'radial';
    return this.state;
  }
  tick(dt: number): Gesture {
    this.elapsed += dt;
    if (this.state === 'hover' && this.target !== 'none' && this.target !== 'floor' && this.elapsed * 1000 >= this.holdMs) this.state = 'menu';
    return this.state;
  }
  release(): Gesture {
    if (this.toggle && this.state === 'hold') return 'hold';
    const result = this.down && this.moved <= controls.dragThresholdPx && this.target === 'floor' ? 'walk' : 'hover';
    this.down = false; this.state = 'hover'; this.elapsed = 0; return result;
  }
  reset(): void { this.state = 'hover'; this.down = false; this.elapsed = this.moved = 0; this.target = 'none'; }
}
