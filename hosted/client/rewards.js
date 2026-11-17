function applyRewards() {
  const state = me?.rewards;
  document.body.dataset.theme = state?.theme ?? 'default';
  const title = state?.rewards.find(reward => reward.kind === 'title' && reward.id === state.title);
  $('#selectedTitle').textContent = title?.name ?? '';
  $('#selectedTitle').classList.toggle('hidden', !title);
  if (!$('#rewardsView').classList.contains('hidden')) renderRewards();
}

function renderRewards() {
  const state = me?.rewards;
  $('#rewardsStatus').textContent = state ? '' : 'Create a profile or sign in to see your milestones.';
  $('#themeRewards').innerHTML = '';
  $('#titleRewards').innerHTML = '';
  $('#rewardSummary').textContent = '';
  if (!state) return;
  $('#rewardSummary').textContent = state.stats.tokens + ' Help Tokens · ' + state.stats.sessions +
    ' completed study sessions · ' + state.stats.thanks + ' thank-yous received';
  for (const kind of ['theme', 'title']) {
    const cards = state.rewards.filter(reward => reward.kind === kind).map(reward => {
      const active = state[kind] === reward.id;
      const unit = {tokens: 'Help Tokens', sessions: 'completed sessions', thanks: 'thank-yous received'}[reward.metric];
      return `<article class="reward-card">
        <span class="reward-preview preview-${safe(reward.id)}" aria-hidden="true">${kind === 'theme' ? '✳' : '✧'}</span>
        <h3>${safe(reward.name)}</h3>
        <p>${reward.threshold} ${unit}</p>
        ${reward.description ? `<p>${safe(reward.description)}</p>` : ''}
        <progress max="${reward.threshold}" value="${Math.min(reward.progress, reward.threshold)}" aria-label="${safe(reward.name)} progress"></progress>
        <small>${reward.unlocked ? 'Unlocked permanently' : Math.min(reward.progress, reward.threshold) + ' / ' + reward.threshold}</small>
        <button class="outline" data-reward="${reward.id}" data-kind="${kind}" ${!reward.unlocked || active ? 'disabled' : ''}>${active ? 'Selected' : reward.unlocked ? 'Select' : 'Milestone ahead'}</button>
      </article>`;
    }).join('');
    const reset = kind === 'theme' ? 'default' : '';
    $('#' + (kind === 'theme' ? 'themeRewards' : 'titleRewards')).innerHTML =
      `<button class="outline reward-reset" data-reward="${reset}" data-kind="${kind}">${kind === 'theme' ? 'Use original theme' : 'Hide my title'}</button>` + cards;
  }
}

$('#rewardsView').addEventListener('click', async event => {
  const button = event.target.closest('button[data-reward]');
  if (!button) return;
  button.disabled = true;
  try {
    me.rewards = await api('/rewards', {
      method: 'POST', body: JSON.stringify({id: button.dataset.reward, kind: button.dataset.kind}),
    });
    applyRewards();
    $('#rewardsStatus').textContent = 'Saved. Your Help Tokens are yours to keep.';
  } catch (error) {
    $('#rewardsStatus').textContent = error.message;
    button.disabled = false;
  }
});
