import { RESOURCE_NAMES, type ColonySnapshot, type InventoryItem } from '../colony/contracts.ts';
import { taskMaterials } from '../colony/task-materials.ts';

export function materialHud(shell: HTMLElement, icon: (item: InventoryItem, className: string) => HTMLElement) {
  const doc = shell.ownerDocument;
  const style = doc.createElement('style');
  style.textContent = `#task-materials{position:absolute;top:12px;right:16px;width:min(236px,42%);padding:9px 12px;z-index:5}
#task-materials h2{font-size:13px;color:#405840;margin-bottom:3px}
#task-materials ul{list-style:none;padding:0;margin:0;max-height:35vh;overflow:auto}
#task-materials li{display:grid;grid-template-columns:1fr auto;gap:2px 6px;border-top:1px solid var(--fx-homestead-line);padding:5px 0 3px}
#task-materials li strong,#task-materials li b{font-size:13px}
#task-materials li b{color:#8c4929;font-variant-numeric:tabular-nums}
#task-materials li span{grid-column:1/-1;font-size:12px;line-height:1.45;color:#506349}
.shell[data-view-mode="character"] #task-materials{top:108px}
.shell:has(:is(.inspector,.help,.settings,.terrain-toolbar,.build-toolbar):not([hidden])) #task-materials ul{max-height:54px}
.shell[data-view-mode="character"]:has(:is(.inspector,.help,.settings):not([hidden])) #task-materials{right:min(312px,47%)}
@media(max-width:720px){#task-materials{top:48px;right:8px}.shell:has(:is(.inspector,.help,.settings,.terrain-toolbar,.build-toolbar):not([hidden])) #task-materials{top:6px}}`;
  const panel = doc.createElement('aside');
  panel.id = 'task-materials';
  panel.className = 'panel';
  panel.hidden = true;
  panel.setAttribute('aria-labelledby','task-materials-heading');
  const heading = doc.createElement('h2');
  heading.id = 'task-materials-heading';
  heading.textContent = '任务缺料';
  const list = doc.createElement('ul');
  list.tabIndex = 0;
  list.setAttribute('aria-label','缺料数量与补给办法');
  list.dataset.interactive = '';
  panel.append(heading,list);
  shell.append(style,panel);
  list.style.overscrollBehavior='contain';
  let previous = '';
  return (colony: ColonySnapshot) => {
    const rows = taskMaterials(colony);
    const stamp = JSON.stringify(rows);
    if (previous === stamp) return;
    previous = stamp;
    panel.hidden = !rows.length;
    list.replaceChildren(...rows.map(({ item, missing, transit, loose, pending, acquire, source }) => {
      const row = doc.createElement('li');
      row.dataset.material = item;
      const name = doc.createElement('strong'), quantity = doc.createElement('b');
      name.textContent = RESOURCE_NAMES[item];
      name.prepend(icon(item, 'material-mini'));
      quantity.textContent = `缺 ${missing}`;
      row.append(name, quantity);
      const hint = (text: string) => {
        const line = doc.createElement('span');
        line.textContent = text;
        row.append(line);
      };
      if (transit) hint(`${transit} 份正运往仓库`);
      if (loose) hint(`地上 ${loose} 份 · 工作 → 搬运入库`);
      if (pending) hint(`${pending} 份已下单 · 等待入库`);
      if (acquire) hint((acquire < missing ? `另缺 ${acquire} · ` : '') + source);
      return row;
    }));
  };
}
