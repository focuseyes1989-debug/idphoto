// Snapshots own metadata only; image documents are referenced, not duplicated.
export class EditHistory {
 constructor(limit=40){this.limit=limit;this.entries=[];this.index=-1;this.group=null;}
 reset(){this.entries=[];this.index=-1;this.group=null;}
 get canUndo(){return this.index>0;}
 get canRedo(){return this.index>=0&&this.index<this.entries.length-1;}
 record(state,key,group=null){
  if(this.entries[this.index]?.key===key)return;
  const merge=group!==null&&group===this.group&&this.index>0&&this.index===this.entries.length-1;
  if(merge)this.entries[this.index]={state,key};
  else{this.entries.splice(this.index+1);this.entries.push({state,key});this.index++;if(this.entries.length>this.limit+1){this.entries.shift();this.index--;}}
  this.group=group;
 }
 target(redo){return this.entries[this.index+(redo?1:-1)]?.state;}
 commit(redo){this.index+=redo?1:-1;this.group=null;}
}
