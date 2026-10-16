import controls from '../../data/interaction.json' with { type: 'json' };
/** Input timestamps survive queued delivery; simulation ticks age the pending menu. */
export class DoubleTap {
  elapsed = Infinity; x = 0; y = 0;
  private lastInputTime: number|null=null;
  step(dt: number): void { this.elapsed += dt; }
  reset(): void { this.elapsed = Infinity;this.lastInputTime=null; }
  tap(x: number, y: number, inputTime?:number): boolean {
    const gap=inputTime!==undefined&&this.lastInputTime!==null?inputTime-this.lastInputTime:this.elapsed;
    const paired = gap>=0 && gap <= controls.doubleTapSeconds && Math.hypot(x - this.x, y - this.y) <= controls.doubleTapRadiusPx;
    this.x = x; this.y = y; this.elapsed = paired ? Infinity : 0;
    this.lastInputTime=paired?null:inputTime??null;
    return paired;
  }
}
