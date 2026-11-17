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
  const courseDetails = curricula.find(curriculum => curriculum.id === current)?.courses ?? [];
  $('#' + prefix + 'Subjects').innerHTML = options.map(subject => {
    const course = courseDetails.find(item => item.value === subject);
    const label = course
      ? `<span class="course-name">${safe(course.name)}<small>${safe(course.qualification)} · ${safe(course.codeType)}</small></span><span class="course-code">${safe(course.code)}</span>`
      : `<span>${safe(subject)}</span>`;
    return `<label class="subject-choice" data-search="${safe(subject.toLocaleLowerCase())}"><input type="checkbox" value="${safe(subject)}" ${selectedKeys.has(subject.toLocaleLowerCase()) ? 'checked' : ''} aria-label="${safe(subject)}">${label}</label>`;
  }).join('');
  const curriculum = curricula.find(item => item.id === current);
  $('#' + prefix + 'CodeHint').textContent = curriculum?.codeHint ?? '';
  $('#' + prefix + 'Sources').innerHTML = (curriculum?.sources ?? []).map(source =>
    `<a href="${safe(source.url)}" target="_blank" rel="noopener noreferrer">${safe(source.name)} ↗</a>`).join(' ');
  filterSubjectChoices(prefix);

}

function setupAcademicForm(prefix, settings) {
  const select = $('#' + prefix + 'Curriculum');
  select.innerHTML = '<option value="">Choose a curriculum</option>' +
    curricula.map(curriculum => `<option value="${safe(curriculum.id)}">${safe(curriculum.name)}</option>`).join('');
  select.value = settings?.curriculum ?? '';
  $('#' + prefix + 'SubjectSearch').value = '';
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

function filterSubjectChoices(prefix) {
  const query = $('#' + prefix + 'SubjectSearch').value.trim().toLocaleLowerCase();
  let shown = 0;
  for (const label of $('#' + prefix + 'Subjects').querySelectorAll('.subject-choice')) {
    const matches = label.dataset.search.includes(query);
    label.classList.toggle('hidden', !matches);
    if (matches) shown++;
  }
  $('#' + prefix + 'SearchStatus').textContent = query
    ? (shown ? shown + ' matching subjects' : 'No match. Add your subject below.')
    : '';
}

for (const prefix of ['auth','account']) {
  $('#' + prefix + 'SubjectSearch').addEventListener('input', () => filterSubjectChoices(prefix));
  $('#' + prefix + 'Curriculum').addEventListener('change', () => {
    // Keep chosen courses while switching curriculum so a change does not erase choices.
    const selected = readAcademicForm(prefix).subjects;
    $('#' + prefix + 'SubjectSearch').value = '';
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
    $('#' + prefix + 'SubjectSearch').value = '';
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
