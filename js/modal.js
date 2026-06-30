import { state } from './state.js';
import { providerMeta, renderMarkdown, escHtml } from './helpers.js';

export function openModal(model, response) {
  state.modalResponse = response || '';
  const pm = providerMeta(model);
  document.getElementById('modal-provider-chip').textContent = pm.name;
  document.getElementById('modal-provider-chip').style.cssText = `background:${pm.color}22;color:${pm.color};border:1px solid ${pm.color}44`;
  document.getElementById('modal-title').textContent = model;
  document.getElementById('modal-body').innerHTML = renderMarkdown(response || '');
  document.getElementById('modal').classList.add('open');
}

export function closeModal() {
  document.getElementById('modal').classList.remove('open');
}
