import chores from '../../data/chores.json' with { type: 'json' };
export class TapFill {
  seconds=0; filled=false; completed=false;
  step(dt: number, underTap: boolean): number {
    if(underTap && !this.filled) {this.seconds=Math.min(chores.stations.water.holdSeconds,this.seconds+dt);this.filled=this.seconds+1e-8>=chores.stations.water.holdSeconds;if(this.filled)this.seconds=chores.stations.water.holdSeconds;}
    return this.seconds/chores.stations.water.holdSeconds;
  }
  returnToStation(x: number,z: number): boolean {
    if(this.filled && !this.completed && Math.hypot(x-1.4,z+.7)<.65){this.completed=true;return true;}return false;
  }
}
