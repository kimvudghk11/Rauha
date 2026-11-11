import { ModelNames, type ModelTier } from '@rauha/core/jobs';
import { el } from './dom.js';

const TIER_LABEL: Readonly<Record<ModelTier, string>> = { haiku: 'Haiku (light tasks)', sonnet: 'Sonnet (most work)', opus: 'Opus (hard problems)' };

/**
 * Settings 의 Models 구역: 등급마다 모델 ID 를 직접 적거나 제안에서 고른다.
 * 이상한 값은 저장하지 않고 이유를 보여 준다. 저장은 바깥(update)이 한다.
 */
export function buildModels(current: Readonly<Record<ModelTier, string>>, update: (models: Record<ModelTier, string>) => Promise<unknown>): HTMLElement[] {
  const list = el('datalist');
  list.id = 'model-suggestions';
  for (const id of ModelNames.KNOWN) list.appendChild(new Option(id));
  const error = el('div', 'err pad');
  error.hidden = true;
  const rows = ModelNames.TIERS.map((tier) => {
    const input = el('input', 'model-id');
    input.setAttribute('list', list.id);
    input.setAttribute('aria-label', `${TIER_LABEL[tier]} model ID`);
    input.spellcheck = false;
    input.placeholder = ModelNames.defaults().idOf(tier);
    input.value = current[tier];
    input.addEventListener('change', () => {
      const reason = ModelNames.checkId(input.value);
      error.hidden = reason === null;
      error.textContent = reason === null ? '' : `${TIER_LABEL[tier]}: ${reason}`;
      if (reason !== null) return;
      void update({ ...current, [tier]: input.value.trim() });
    });
    const row = el('label', 'srow');
    row.append(el('span', 'lbl', TIER_LABEL[tier]), input);
    return row;
  });
  const reset = el('button', 'btn', 'Reset to default');
  reset.type = 'button';
  reset.addEventListener('click', () => void update(ModelNames.defaults().toRecord()));
  const actions = el('div', 'srow');
  actions.append(el('span', 'lbl'), reset);
  const hint = el('div', 'hint pad', 'Model IDs for each tier. Type your own ID (for example claude-fable-5-2) or pick a suggestion. Applies from the next request.');
  return [list, ...rows, error, actions, hint];
}
