export interface CarryPosition { x:number;y:number;z:number }
/** Contact positions are stored per prop; an invalid drop returns to the pickup point. */
export class HoldDrag {
  id:string|null=null;lastId='';
  readonly placements=new Map<string,CarryPosition>([
    ['water-bowl',{x:1.4,y:.08,z:-.7}],['food-bowl',{x:1.9,y:.08,z:-.7}],['scoop',{x:4.65,y:.37,z:-3.9}],
  ]);
  readonly origin={x:1.4,y:.08,z:-.7};readonly position={x:1.4,y:.08,z:-.7};
  start(id:string):boolean {
    const placed=this.placements.get(id);if(!placed || this.id)return false;
    this.id=this.lastId=id;Object.assign(this.origin,placed);Object.assign(this.position,placed);return true;
  }
  move(x:number,y:number,z:number):void {if(this.id){this.position.x=x;this.position.y=y;this.position.z=z;}}
  release(surface:string,x=this.position.x,z=this.position.z,y=.08):boolean {
    if(!this.id)return false;
    const valid=(surface==='floor'||surface==='table-1'||surface==='table-2')&&x>-4.8&&x<4.8&&z>-4.8&&z<2.8;
    if(valid){this.position.x=x;this.position.y=y;this.position.z=z;}else Object.assign(this.position,this.origin);
    Object.assign(this.placements.get(this.id)!,this.position);this.id=null;return valid;
  }
}
