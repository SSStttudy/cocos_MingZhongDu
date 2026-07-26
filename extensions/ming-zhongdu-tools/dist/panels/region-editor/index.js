'use strict';

const PACKAGE_NAME = 'ming-zhongdu-tools';

async function runScene(method, ...args) {
    return Editor.Message.request('scene', 'execute-scene-script', {
        name: PACKAGE_NAME,
        method,
        args,
    });
}

module.exports = Editor.Panel.define({
    template: `
<div id="app">
  <header><strong>照片透视区域编辑器</strong><button id="refresh">刷新</button></header>
  <section class="scene-section">
    <h3>正在编辑的分镜</h3>
    <select id="scene-select"><option value="exterior">exterior</option><option value="interior">interior</option></select>
    <h3 style="margin-top:12px">透视标定</h3>
    <button id="ensure-perspective">创建／修复当前分镜标定</button>
    <small><code>PerspectiveNear</code> 的下边缘是最近点，矩形高度是人物高度；<code>PerspectiveHorizon</code> 是视觉终线。两个节点只需上下调整 Y。</small>
    <small>切换后，背景与区域会一起切换。每张照片分镜独立保存。</small>
  </section>
  <section>
    <h3>新建规则多边形</h3>
    <label>区域 ID<input id="new-id" value="walk-main"></label>
    <label>区域类型<select id="new-type">
      <option value="0">可行走 Walkable</option><option value="1">障碍 Obstacle</option>
      <option value="2">交互 Interaction</option><option value="3">切景 Transition</option>
      <option value="4">遮挡 Occlusion</option><option value="5">出生点 Spawn</option>
    </select></label>
    <div class="row"><label>边数<input id="new-sides" type="number" min="3" max="32" value="4"></label>
    <label>半径<input id="new-radius" type="number" min="20" max="600" value="120"></label></div>
    <button id="create" class="primary">创建 N 边形</button>
  </section>
  <section>
    <h3>当前区域</h3>
    <select id="region-list" size="6"></select>
    <label>区域 ID<input id="edit-id" placeholder="例如 spawn-road / obstacle-tree"></label>
    <small>统一使用小写英文与短横线；修改后会同步层级节点名称。</small>
    <label>类型<select id="edit-type">
      <option value="0">可行走</option><option value="1">障碍</option><option value="2">交互</option>
      <option value="3">切景</option><option value="4">遮挡</option>
      <option value="5">出生点</option>
    </select></label>
    <label>优先级<input id="priority" type="number" value="0"></label>
    <label class="check"><input id="enabled" type="checkbox" checked> 启用区域</label>
    <details open><summary>交互属性</summary>
      <label>Handler ID<input id="handler-id" placeholder="open-detail"></label>
      <label>提示文字<input id="prompt" placeholder="调查"></label>
      <label>触发方式<select id="trigger-mode"><option value="button">按键确认</option><option value="enter">进入即触发</option></select></label>
      <label>Payload JSON<textarea id="payload">{}</textarea></label>
    </details>
    <details><summary>切景属性</summary>
      <label>目标出生点<select id="target-spawn-ref"><option value="">请选择其他分镜的出生点</option></select></label>
      <small>出生点已包含所属分镜；选择后会同时保存目标分镜与出生点。</small>
      <label>大地图入口<input id="overworld-entry"></label>
    </details>
    <button id="apply" class="primary">应用属性并保存</button>
    <div class="button-grid"><button id="add-vertex">最长边插入顶点</button><button id="remove-vertex">删除末尾顶点</button>
      <button id="delete" class="danger">删除区域并保存</button></div>
  </section>
  <section>
    <h3>保存与检查</h3>
    <button id="save-apply" class="primary">保存并应用（拖动顶点后点这里）</button>
    <div class="button-grid"><button id="validate">验证当前分镜</button><button id="save-scene">仅保存场景</button></div>
    <pre id="status">等待操作</pre>
  </section>
</div>`,
    style: `
:host { color: var(--color-normal-contrast-weakest); }
#app { padding:10px; font-size:13px; overflow:auto; height:100%; box-sizing:border-box; }
header { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
header strong { font-size:16px; }
section { border:1px solid var(--color-normal-border); border-radius:6px; padding:10px; margin-bottom:10px; background:var(--color-normal-fill); }
.scene-section { border-color:#5a85aa; } h3 { margin:0 0 8px; font-size:14px; }
label { display:flex; flex-direction:column; gap:4px; margin:7px 0; } label.check { flex-direction:row; align-items:center; }
input, select, textarea, button { box-sizing:border-box; width:100%; min-height:28px; color:inherit; background:var(--color-normal-fill-emphasis); border:1px solid var(--color-normal-border); border-radius:4px; }
textarea { min-height:56px; resize:vertical; font-family:monospace; } button { cursor:pointer; padding:4px 8px; }
button.primary { background:#315f88; } button.danger { background:#783e3b; }
.row,.button-grid { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:6px; }
#region-list { min-height:120px; } details { border-top:1px solid var(--color-normal-border); margin-top:8px; padding-top:6px; }
summary { cursor:pointer; } small { display:block; opacity:.75; margin-top:6px; }
#status { white-space:pre-wrap; max-height:180px; overflow:auto; padding:8px; background:#17191b; border-radius:4px; }
`,
    $: {
        refresh:'#refresh', scene:'#scene-select', ensurePerspective:'#ensure-perspective', newId:'#new-id', newType:'#new-type', newSides:'#new-sides', newRadius:'#new-radius', create:'#create',
        list:'#region-list', editId:'#edit-id', editType:'#edit-type', priority:'#priority', enabled:'#enabled', handlerId:'#handler-id', prompt:'#prompt',
        triggerMode:'#trigger-mode', payload:'#payload', targetSpawnRef:'#target-spawn-ref', overworldEntry:'#overworld-entry',
        apply:'#apply', addVertex:'#add-vertex', removeVertex:'#remove-vertex', delete:'#delete', validate:'#validate', saveApply:'#save-apply',
        saveScene:'#save-scene', status:'#status',
    },
    methods: {
        setStatus(value) { this.$.status.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2); },
        sceneId() { return this.$.scene.value || 'exterior'; },
        selectedId() { return this.$.list.value || ''; },
        async populateScenes() {
            const previous = this.sceneId();
            const ids = await runScene('listSceneIds');
            const labels = {
                'entrance-gate': '入口桥 entrance-gate',
                'main-road': '中轴道路 main-road',
                'cafe-garden': '咖啡庭院 cafe-garden',
                'leisure-plaza': '休闲广场 leisure-plaza',
                'visitor-building': '展馆外院 visitor-building',
                exterior: '雕像院落 exterior',
                interior: '室内展厅 interior',
            };
            this.$.scene.innerHTML = '';
            for (const id of ids) {
                const option = document.createElement('option');
                option.value = id;
                option.textContent = labels[id] || id;
                this.$.scene.appendChild(option);
            }
            if (ids.includes(previous)) this.$.scene.value = previous;
        },
        async activateScene() { await runScene('setPreviewScene', this.sceneId()); },
        async populateSpawnTargets(selectedValue = '') {
            const targets = await runScene('listSpawnTargets', this.sceneId());
            this.$.targetSpawnRef.innerHTML = '<option value="">请选择其他分镜的出生点</option>';
            for (const target of targets || []) {
                const option = document.createElement('option');
                option.value = `${target.sceneId}::${target.spawnId}`;
                option.textContent = target.label;
                this.$.targetSpawnRef.appendChild(option);
            }
            if (selectedValue) this.$.targetSpawnRef.value = selectedValue;
        },
        async saveApply(message = '已保存并应用') {
            const result = await runScene('exportRegions');
            await Editor.Message.request('asset-db', 'refresh-asset', 'db://assets/resources/locations');
            await Editor.Message.request('scene', 'save-scene');
            this.setStatus(`${message}\n${JSON.stringify(result, null, 2)}`);
            return result;
        },
        async refreshRegions(selectId = '') {
            try {
                await this.activateScene();
                await this.populateSpawnTargets();
                const regions = await runScene('listRegions', this.sceneId());
                this.regions = regions || [];
                this.$.list.innerHTML = '';
                for (const region of this.regions) {
                    const option = document.createElement('option');
                    option.value = region.id;
                    option.textContent = `${region.typeName} · ${region.id} · ${region.points.length}点`;
                    this.$.list.appendChild(option);
                }
                if (selectId) this.$.list.value = selectId;
                if (!this.$.list.value && this.regions.length) this.$.list.value = this.regions[0].id;
                this.loadSelected();
                this.setStatus(`分镜 ${this.sceneId()}：${this.regions.length} 个区域`);
            } catch (error) { this.setStatus(`刷新失败：${error.message || error}`); }
        },
        loadSelected() {
            const region = (this.regions || []).find((item) => item.id === this.selectedId());
            if (!region) return;
            this.$.editId.value=region.id; this.$.editType.value=String(region.type); this.$.priority.value=String(region.priority||0); this.$.enabled.checked=region.enabled!==false;
            this.$.handlerId.value=region.handlerId||''; this.$.prompt.value=region.prompt||''; this.$.triggerMode.value=region.triggerMode||'button';
            this.$.payload.value=region.payload||'{}';
            this.populateSpawnTargets(region.targetSceneId && region.targetSpawnId ? `${region.targetSceneId}::${region.targetSpawnId}` : '');
            this.$.overworldEntry.value=region.overworldEntryId||'';
        },
    },
    ready() {
        this.regions=[];
        this.$.refresh.addEventListener('click',async()=>{
            try {
                await Editor.Message.request('asset-db', 'refresh-asset', 'db://assets/resources/locations');
                await this.populateScenes();
                await this.refreshRegions();
            } catch (error) { this.setStatus(`重新扫描失败：${error.message || error}`); }
        });
        this.$.scene.addEventListener('change',()=>this.refreshRegions());
        this.$.ensurePerspective.addEventListener('click',async()=>{try{
            await this.activateScene();
            const result=await runScene('ensurePerspectiveCalibration',this.sceneId());
            await this.saveApply('透视标定已创建；请在场景中只上下拖动两个标准节点');
            this.setStatus(`透视标定已创建并保存\n${JSON.stringify(result,null,2)}`);
        }catch(error){this.setStatus(`创建透视标定失败：${error.message||error}`);}});
        this.$.list.addEventListener('change',()=>this.loadSelected());
        this.$.create.addEventListener('click',async()=>{ try {
            await this.activateScene();
            const region=await runScene('createRegularRegion',{sceneId:this.sceneId(),id:this.$.newId.value,type:Number(this.$.newType.value),sides:Number(this.$.newSides.value),radius:Number(this.$.newRadius.value)});
            await this.refreshRegions(region.id); await this.saveApply(`已创建 ${region.id}`);
        } catch(error){this.setStatus(`创建失败：${error.message||error}`);} });
        this.$.apply.addEventListener('click',async()=>{ const id=this.selectedId(); if(!id)return this.setStatus('请先选择区域'); try {
            const [targetSceneId='', targetSpawnId=''] = this.$.targetSpawnRef.value.split('::');
            const updated=await runScene('setRegionProperties',{sceneId:this.sceneId(),id,newId:this.$.editId.value,type:Number(this.$.editType.value),priority:Number(this.$.priority.value),enabled:this.$.enabled.checked,
                handlerId:this.$.handlerId.value,prompt:this.$.prompt.value,triggerMode:this.$.triggerMode.value,payload:this.$.payload.value,
                targetSceneId,targetSpawnId,overworldEntryId:this.$.overworldEntry.value});
            await this.refreshRegions(updated.id); await this.saveApply(`已应用 ${updated.id}`);
        } catch(error){this.setStatus(`应用失败：${error.message||error}`);} });
        this.$.addVertex.addEventListener('click',async()=>{ const id=this.selectedId(); if(!id)return; try{await runScene('addVertex',id,this.sceneId());await this.refreshRegions(id);await this.saveApply('已增加顶点');}catch(error){this.setStatus(String(error));} });
        this.$.removeVertex.addEventListener('click',async()=>{ const id=this.selectedId(); if(!id)return; try{await runScene('removeVertex',id,this.sceneId());await this.refreshRegions(id);await this.saveApply('已删除顶点');}catch(error){this.setStatus(String(error));} });
        this.$.delete.addEventListener('click',async()=>{ const id=this.selectedId(); if(!id)return; try{await runScene('deleteRegion',id,this.sceneId());await this.refreshRegions();await this.saveApply(`已删除 ${id}`);}catch(error){this.setStatus(String(error));} });
        this.$.validate.addEventListener('click',async()=>{try{this.setStatus(await runScene('validateRegions',this.sceneId()));}catch(error){this.setStatus(String(error));}});
        this.$.saveApply.addEventListener('click',async()=>{try{await this.saveApply();}catch(error){this.setStatus(`保存失败：${error.message||error}`);}});
        this.$.saveScene.addEventListener('click',async()=>{try{await Editor.Message.request('scene','save-scene');this.setStatus('场景已保存（JSON 未更新）');}catch(error){this.setStatus(String(error));}});
        this.populateScenes().then(()=>this.refreshRegions()).catch((error)=>this.setStatus(String(error)));
    },
});
