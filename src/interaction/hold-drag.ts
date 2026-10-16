export class HoldDrag {
  id: string | null = null; lastId = '';
  readonly origin = {x:1.4,y:.08,z:-.7};
  readonly position = {x:1.4,y:.08,z:-.7};
  start(id: string): boolean { if(id!=='water-bowl' && id!=='food-bowl' && id!=='scoop')return false;this.id=id;this.lastId=id;if(id==='food-bowl')Object.assign(this.origin,{x:1.9,y:.08,z:-.7});else if(id==='scoop')Object.assign(this.origin,{x:4.4,y:.4,z:-3});else Object.assign(this.origin,{x:1.4,y:.08,z:-.7});return true; }
  move(x: number,y: number,z: number): void { if(this.id){this.position.x=x;this.position.y=y;this.position.z=z;} }
  release(surface: string, x=this.position.x,z=this.position.z): boolean {
    const valid=surface==='floor' && x>-4.8 && x<4.8 && z>-4.8 && z<2.8;
    if(valid) { this.position.x=x;this.position.y=this.origin.y;this.position.z=z; }
    else Object.assign(this.position,this.origin);
    this.id=null;return valid;
  }
}
