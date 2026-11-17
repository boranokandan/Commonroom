function curriculumSubjects(id) {
  return curricula.find(curriculum => curriculum.id === id)?.subjects ?? [];
}

function readAcademicForm(prefix) {
  return {
    curriculum: $('#' + prefix + 'Curriculum').value,
    subjects: Array.from($('#' + prefix + 'Subjects').querySelectorAll('input:checked'), input => input.value),
  };
}

function renderSubjectChoices(prefix, selected = []) {
  const current = $('#' + prefix + 'Curriculum').value;
  const seen = new Set();
  const options = [...curriculumSubjects(current), ...selected].filter(subject => {
    const key = subject.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const selectedKeys = new Set(selected.map(subject => subject.toLocaleLowerCase()));
  $('#' + prefix + 'Subjects').innerHTML = options.map(subject =>
    `<label class="subject-choice"><input type="checkbox" value="${safe(subject)}" ${selectedKeys.has(subject.toLocaleLowerCase()) ? 'checked' : ''}><span>${safe(subject)}</span></label>`
  ).join('');
}

function setupAcademicForm(prefix, settings) {
  const select = $('#' + prefix + 'Curriculum');
  select.innerHTML = '<option value="">Choose a curriculum</option>' +
    curricula.map(curriculum => `<option value="${safe(curriculum.id)}">${safe(curriculum.name)}</option>`).join('');
  select.value = settings?.curriculum ?? '';
  renderSubjectChoices(prefix, settings?.subjects ?? []);
  $('#' + prefix + 'CustomSubject').value = '';
}

function renderAccount() {
  $('#accountAccess').classList.toggle('hidden', Boolean(me));
  $('#accountForm').classList.toggle('hidden', !me);
  $('#accountStatus').textContent = '';
  if (me) setupAcademicForm('account', me.academics);
}

function updateMySubjects() {
  const summary = $('#mySubjectsSummary');
  summary.classList.toggle('hidden', !me?.academics);
  if (!me?.academics) return;
  const label = curricula.find(curriculum => curriculum.id === me.academics.curriculum)?.name ?? '';
  summary.textContent = label + ' · ' +
    (me.academics.subjects.join(', ') || 'Choose subjects in Account settings');
  const current = $('#newSubject').value;
  const options = [...new Set([...(me.academics.subjects ?? []), ...subjects])];
  $('#newSubject').innerHTML = options.map(subject =>
    `<option value="${safe(subject)}">${safe(subject)}</option>`).join('');
  if (options.includes(current)) $('#newSubject').value = current;
  const filter = $('#subjectFilter');
  const prior = filter.value;
  const available = [...new Set([...options, ...sessions.map(session => session.subject)])];
  filter.innerHTML = '<option value="all">All subjects</option>' + available.map(subject =>
    `<option value="${safe(subject)}">${safe(subject)}</option>`).join('');
  filter.value = available.includes(prior) ? prior : 'all';
}

for (const prefix of ['auth','account']) {
  $('#' + prefix + 'Curriculum').addEventListener('change', () => {
    // Keep chosen courses while switching curriculum so a change does not erase choices.
    const selected = readAcademicForm(prefix).subjects;
    renderSubjectChoices(prefix, selected);
  });
  const addSubject = () => {
    const input = $('#' + prefix + 'CustomSubject');
    const subject = input.value.trim();
    if (!subject) return;
    const selected = readAcademicForm(prefix).subjects;
    if (!selected.some(value => value.toLocaleLowerCase() === subject.toLocaleLowerCase())) selected.push(subject);
    if (selected.length > 30) {
      input.setCustomValidity('Choose up to 30 subjects.');
      input.reportValidity();
      return;
    }
    input.setCustomValidity('');
    renderSubjectChoices(prefix, selected);
    input.value = '';
  };
  $('#' + prefix + 'AddSubject').addEventListener('click', addSubject);
  $('#' + prefix + 'CustomSubject').addEventListener('input', event => event.target.setCustomValidity(''));
  $('#' + prefix + 'CustomSubject').addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addSubject();
    }
  });
}

$('#accountForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type=submit]');
  button.disabled = true;
  try {
    await api('/account', {method:'POST',body:JSON.stringify(readAcademicForm('account'))});
    await refresh();
    $('#accountStatus').textContent = 'Your curriculum and subjects are saved.';
  } catch (error) {
    $('#accountStatus').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
