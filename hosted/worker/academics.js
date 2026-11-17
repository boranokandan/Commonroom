// These are starting lists of subjects. Students can add their school's course names.
export const curriculumCatalog = [
  {id: 'ib-dp', name: 'IB Diploma Programme', subjects: ['Mathematics', 'Biology', 'Chemistry', 'Physics', 'English', 'History', 'Economics', 'Psychology', 'Languages', 'Computer Science', 'Visual Arts']},
  {id: 'cambridge', name: 'Cambridge IGCSE / A Levels', subjects: ['Mathematics', 'Further Mathematics', 'Biology', 'Chemistry', 'Physics', 'English', 'History', 'Geography', 'Economics', 'Business', 'Computer Science', 'Languages']},
  {id: 'us', name: 'US High School / AP', subjects: ['Mathematics', 'Calculus', 'Statistics', 'Biology', 'Chemistry', 'Physics', 'English', 'History', 'Government', 'Economics', 'Computer Science', 'Languages', 'Art']},
  {id: 'turkiye', name: 'Türkiye — High School', subjects: ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'Turkish Language and Literature', 'History', 'Geography', 'Philosophy', 'English', 'Languages']},
  {id: 'other', name: 'Other curriculum', subjects: ['Mathematics', 'Science', 'English', 'History', 'Languages', 'Other']},
];
export const sessionSubjects = new Set([
  'Mathematics', 'Science', 'English', 'History', 'Languages', 'Other',
  ...curriculumCatalog.flatMap(curriculum => curriculum.subjects),
]);

export function validateAcademics(data) {
  if (!curriculumCatalog.some(curriculum => curriculum.id === data.curriculum)) {
    throw [400, 'Choose a curriculum.'];
  }
  if (!Array.isArray(data.subjects) || data.subjects.length > 30) {
    throw [400, 'Choose up to 30 subjects.'];
  }
  const subjects = data.subjects.map(subject => {
    if (typeof subject !== 'string' || !subject.trim() || subject.trim().length > 60) {
      throw [400, 'Subject names must be 1–60 characters.'];
    }
    return subject.trim();
  });
  if (new Set(subjects.map(subject => subject.toLocaleLowerCase())).size !== subjects.length) {
    throw [400, 'Remove duplicate subjects.'];
  }
  return {curriculum: data.curriculum, subjects};
}

export async function academicSettings(db, userId) {
  const row = await db.prepare('SELECT curriculum,subjects FROM academic_settings WHERE user_id=?').bind(userId).first();
  return row ? {curriculum: row.curriculum, subjects: JSON.parse(row.subjects)} : null;
}
