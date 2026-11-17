let nextQuestion = null;
let loadingQuestions = false;
let pendingRecognition = null;
const questionDate = value => new Date(value * 1000).toLocaleDateString();

function updateQuestionSubjects() {
  const ownSubjects = [...new Set([...(me?.academics?.subjects ?? []), ...subjects])];
  const filterSubjects = [...new Set([...ownSubjects, ...curricula.flatMap(curriculum => curriculum.subjects)])];
  for (const [selector, options, placeholder] of [
    ['#questionSubject', ownSubjects, null],
    ['#questionSubjectFilter', filterSubjects, 'All subjects'],
  ]) {
    const select = $(selector);
    const previous = select.value;
    select.innerHTML = (placeholder ? '<option value="">' + placeholder + '</option>' : '') +
      options.map(subject => `<option value="${safe(subject)}">${safe(subject)}</option>`).join('');
    if (options.includes(previous)) select.value = previous;
  }
}

function favoriteButton(kind, id, questionId, saved) {
  return `<button class="outline favorite-button" type="button" data-save-kind="${kind}"
    data-save-id="${id}" data-question-id="${questionId}" data-is-saved="${saved ? 'true' : 'false'}"
    aria-pressed="${Boolean(saved)}">${saved ? '♥ Saved' : '♡ Save'}${kind === 'answer' ? ' explanation' : ' question'}</button>`;
}

function questionCard(question, context = 'feed') {
  const id = question.id;
  const answerLabel = question.answer_count === 1 ? '1 answer' : question.answer_count + ' answers';
  return `<article class="question-card">
    <small class="question-meta">${safe(question.author)} · ${questionDate(question.created_at)}</small>
    <p class="question-subject">${safe(question.subject ?? 'Other')}</p>
    ${question.content ? `<p class="question-copy">${safe(question.content)}</p>` : ''}
    ${question.has_photo ? `<a href="/api/questions/${id}/photo" target="_blank" rel="noopener" aria-label="Open question photo"><img class="question-photo" src="/api/questions/${id}/photo" alt="Photo attached to this question" loading="lazy"></a>` : ''}
    ${favoriteButton('question', id, id, question.saved)}
    <details data-question-id="${id}">
      <summary><span class="answer-count">${answerLabel}</span> · Answer</summary>
      <div class="question-answers"></div>
      <form class="answer-form">
        <label for="answer-${context}-${id}">Your answer</label>
        <textarea id="answer-${context}-${id}" name="answer" rows="3" required maxlength="2000" placeholder="Share a hint or explain a step…"></textarea>
        <button class="outline" type="submit">Post answer</button>
        <p class="board-status" role="status"></p>
      </form>
    </details>
  </article>`;
}

async function loadQuestionBoard(older = false) {
  $('#questionAccess').classList.toggle('hidden', Boolean(me));
  $('#questionBoard').classList.toggle('hidden', !me);
  if (!me || loadingQuestions || (older && !nextQuestion)) return;
  loadingQuestions = true;
  const status = $('#feedStatus');
  status.textContent = 'Loading questions…';
  try {
    const params = new URLSearchParams();
    if (older) params.set('before', nextQuestion);
    if ($('#questionSubjectFilter').value) params.set('subject', $('#questionSubjectFilter').value);
    const page = await api('/questions?' + params);
    const feed = $('#questionFeed');
    const markup = page.questions.map(question => questionCard(question)).join('');
    if (older) feed.insertAdjacentHTML('beforeend', markup);
    else feed.innerHTML = markup || '<div class="empty">No questions here yet. Ask the first one.</div>';
    nextQuestion = page.next;
    $('#olderQuestions').classList.toggle('hidden', !nextQuestion);
    status.textContent = '';
  } catch (error) {
    status.textContent = error.message;
  } finally {
    loadingQuestions = false;
  }
}

async function loadAnswers(thread) {
  const list = thread.querySelector('.question-answers');
  try {
    const {answers, can_thank} = await api('/questions/' + thread.dataset.questionId + '/answers');
    list.innerHTML = answers.map(answer => `<div class="question-answer">
      <small class="question-meta">${safe(answer.author)} · ${questionDate(answer.created_at)}</small>
      <p class="question-copy">${safe(answer.content)}</p>
      <div class="answer-actions">${favoriteButton('answer', answer.id, thread.dataset.questionId, answer.saved)}
      ${can_thank && !answer.mine ? `<button class="outline" type="button" data-recognize="${answer.id}" data-question-id="${thread.dataset.questionId}">This helped me</button>` : ''}</div>
    </div>`).join('') || '<p class="board-status">No answers yet.</p>';
    thread.querySelector('.answer-count').textContent = answers.length + (answers.length === 1 ? ' answer' : ' answers');
  } catch (error) {
    list.textContent = error.message;
  }
}

async function loadSaved() {
  const status = $('#savedStatus');
  $('#savedQuestions').innerHTML = '';
  $('#savedExplanations').innerHTML = '';
  if (!me) {
    status.textContent = 'Sign in or create a profile to save questions and explanations.';
    return;
  }
  status.textContent = 'Loading saved items…';
  try {
    const saved = await api('/saved');
    $('#savedQuestions').innerHTML = saved.questions.map(question => questionCard(question, 'saved')).join('') ||
      '<div class="empty">Save a question to find it here.</div>';
    $('#savedExplanations').innerHTML = saved.explanations.map(answer => `<article class="question-card">
      <small class="question-meta">${safe(answer.author)} · ${questionDate(answer.created_at)}</small>
      <p class="question-subject">${safe(answer.subject)}</p>
      <p class="saved-context">Question · ${safe(answer.question_content || 'Photo question')}</p>
      <p class="question-copy">${safe(answer.content)}</p>
      <div class="answer-actions">${favoriteButton('answer', answer.id, answer.question_id, true)}
      <button class="outline" type="button" data-open-question="${answer.question_id}">Open question</button></div>
    </article>`).join('') || '<div class="empty">Save an explanation to revisit it here.</div>';
    status.textContent = '';
  } catch (error) {
    status.textContent = error.message;
  }
}

$('#refreshQuestions').onclick = () => loadQuestionBoard();
$('#olderQuestions').onclick = () => loadQuestionBoard(true);
$('#questionSubjectFilter').onchange = () => loadQuestionBoard();

document.addEventListener('toggle', event => {
  if (event.target.matches('details[data-question-id]') && event.target.open) loadAnswers(event.target);
}, true);

$('#questionForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const status = $('#questionStatus');
  const data = new FormData(form);
  const photo = form.elements.photo.files[0];
  if (!photo && !form.elements.question.value.trim()) {
    status.textContent = 'Write a question or attach a photo.';
    return;
  }
  if (photo?.size > 5 * 1024 * 1024) {
    status.textContent = 'Choose a photo up to 5 MB.';
    return;
  }
  if (!photo) data.delete('photo');
  button.disabled = true;
  status.textContent = 'Posting question…';
  try {
    await api('/questions', {method: 'POST', headers: {}, body: data});
    form.reset();
    $('#questionSubjectFilter').value = '';
    status.textContent = 'Question posted.';
    await loadQuestionBoard();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.addEventListener('submit', async event => {
  const form = event.target;
  if (!form.matches('.answer-form')) return;
  event.preventDefault();
  const answer = form.elements.answer.value.trim();
  const status = form.querySelector('[role="status"]');
  if (!answer) {
    status.textContent = 'Write an answer first.';
    return;
  }
  const button = form.querySelector('button');
  const thread = form.closest('details');
  button.disabled = true;
  status.textContent = 'Posting answer…';
  try {
    await api('/questions/' + thread.dataset.questionId + '/answers', {
      method: 'POST', body: JSON.stringify({answer}),
    });
    form.reset();
    await loadAnswers(thread);
    status.textContent = 'Answer posted.';
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.hasAttribute('data-recognize')) {
    pendingRecognition = {answerId: button.dataset.recognize, questionId: button.dataset.questionId};
    $('#recognitionNote').value = '';
    $('#recognitionError').textContent = '';
    $('#recognitionDialog').showModal();
    return;
  }
  if (button.hasAttribute('data-save-kind')) {
    button.disabled = true;
    const saved = button.dataset.isSaved !== 'true';
    const path = '/questions/' + button.dataset.questionId +
      (button.dataset.saveKind === 'answer' ? '/answers/' + button.dataset.saveId : '') + '/favorite';
    try {
      await api(path, {method: 'POST', body: JSON.stringify({saved})});
      const selector = `[data-save-kind="${button.dataset.saveKind}"][data-save-id="${button.dataset.saveId}"]`;
      document.querySelectorAll(selector).forEach(control => {
        control.dataset.isSaved = String(saved);
        control.setAttribute('aria-pressed', String(saved));
        control.textContent = (saved ? '♥ Saved' : '♡ Save') + (button.dataset.saveKind === 'answer' ? ' explanation' : ' question');
      });
      if (!$('#savedView').classList.contains('hidden')) await loadSaved();
    } catch (error) {
      showNotice(error.message, true);
    } finally {
      button.disabled = false;
    }
  }
  if (button.hasAttribute('data-open-question')) {
    button.disabled = true;
    try {
      const {question} = await api('/questions/' + button.dataset.openQuestion);
      view('questions');
      $('#questionAccess').classList.add('hidden');
      $('#questionBoard').classList.remove('hidden');
      $('#questionFeed').innerHTML = questionCard(question);
      $('#olderQuestions').classList.add('hidden');
      $('#feedStatus').textContent = 'Viewing a saved question. Refresh to return to the question board.';
      const thread = $('#questionFeed details');
      thread.open = true;
    } catch (error) {
      showNotice(error.message, true);
    } finally {
      button.disabled = false;
    }
  }
});

$('#recognitionForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!pendingRecognition) return;
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await api('/questions/' + pendingRecognition.questionId + '/answers/' + pendingRecognition.answerId + '/thank', {
      method: 'POST', body: JSON.stringify({note: $('#recognitionNote').value}),
    });
    pendingRecognition = null;
    $('#recognitionDialog').close();
    await refresh();
    showNotice('Thank-you sent. Your classmate received 3 Help Tokens and your private note.');
  } catch (error) {
    $('#recognitionError').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
