let nextQuestion = null;
let loadingQuestions = false;
const questionDate = value => new Date(value * 1000).toLocaleDateString();

function questionCard(question) {
  const id = question.id;
  const answerLabel = question.answer_count === 1 ? '1 answer' : question.answer_count + ' answers';
  return `<article class="question-card">
    <small class="question-meta">${safe(question.author)} · ${questionDate(question.created_at)}</small>
    ${question.content ? `<p class="question-copy">${safe(question.content)}</p>` : ''}
    ${question.has_photo ? `<a href="/api/questions/${id}/photo" target="_blank" rel="noopener" aria-label="Open question photo"><img class="question-photo" src="/api/questions/${id}/photo" alt="Photo attached to this question" loading="lazy"></a>` : ''}
    <details data-question-id="${id}">
      <summary><span class="answer-count">${answerLabel}</span> · Answer</summary>
      <div class="question-answers"></div>
      <form class="answer-form">
        <label for="answer-${id}">Your answer</label>
        <textarea id="answer-${id}" name="answer" rows="3" required maxlength="2000" placeholder="Share a hint or explain a step…"></textarea>
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
    const page = await api('/questions' + (older ? '?before=' + nextQuestion : ''));
    const feed = $('#questionFeed');
    const markup = page.questions.map(questionCard).join('');
    if (older) feed.insertAdjacentHTML('beforeend', markup);
    else feed.innerHTML = markup || '<div class="empty">No questions yet. Ask the first one.</div>';
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
    const {answers} = await api('/questions/' + thread.dataset.questionId + '/answers');
    list.innerHTML = answers.map(answer => `<div class="question-answer">
      <small class="question-meta">${safe(answer.author)} · ${questionDate(answer.created_at)}</small>
      <p class="question-copy">${safe(answer.content)}</p>
    </div>`).join('') || '<p class="board-status">No answers yet.</p>';
    thread.querySelector('.answer-count').textContent = answers.length + (answers.length === 1 ? ' answer' : ' answers');
  } catch (error) {
    list.textContent = error.message;
  }
}

$('#refreshQuestions').onclick = () => loadQuestionBoard();
$('#olderQuestions').onclick = () => loadQuestionBoard(true);

$('#questionFeed').addEventListener('toggle', event => {
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
    status.textContent = 'Question posted.';
    await loadQuestionBoard();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$('#questionFeed').addEventListener('submit', async event => {
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
