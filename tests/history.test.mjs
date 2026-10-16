import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EditHistory} from '../web/history.js';
test('history groups drags, clears redo branches and bounds metadata snapshots',()=>{
 const h=new EditHistory(2);h.record({angle:0},'0');h.record({angle:5},'5','drag');h.record({angle:12},'12','drag');
 assert.equal(h.entries.length,2);assert.equal(h.target(false).angle,0);h.commit(false);assert.equal(h.canRedo,true);h.commit(true);assert.equal(h.entries[h.index].state.angle,12);
 h.commit(false);h.record({angle:7},'7');assert.equal(h.canRedo,false);h.record({angle:8},'8');h.record({angle:9},'9');assert.equal(h.entries.length,3);assert.equal(h.target(false).angle,8);
 h.reset();assert.equal(h.canUndo,false);assert.equal(h.canRedo,false);
});
