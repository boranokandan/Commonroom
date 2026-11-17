// Codes checked against the linked awarding-body sources on 2026-11-17.
// Values include qualification or level so equally named subjects stay distinct.
const cambridgeALevelSource = 'https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-advanced/cambridge-international-as-and-a-levels/subjects/';
const cambridgeIGCSESource = 'https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-upper-secondary/cambridge-igcse/subjects/';
const ibSource = 'https://www.ibo.org/globalassets/new-structure/programmes/dp/pdfs/all-dp-subjects-list-en.pdf';
const apSource = 'https://apcentral.collegeboard.org/media/pdf/ap-hed-student-data-record-layout-csv-2026.pdf';

function codedCourses(rows, qualification, source, codeType) {
  return rows.map(([name, code]) => ({
    name, code, qualification, source, codeType,
    value: name + ' · ' + qualification + ' · ' + code,
  }));
}
const cambridgeCourses = [
  ...codedCourses([
    ['Mathematics', '9709'], ['Further Mathematics', '9231'],
    ['Biology', '9700'], ['Chemistry', '9701'], ['Physics', '9702'],
    ['Computer Science', '9618'], ['Economics', '9708'], ['Business', '9609'],
    ['English Language', '9093'], ['Literature in English', '9695'],
    ['Geography', '9696'], ['Psychology', '9990'],
  ], 'AS/A Level', cambridgeALevelSource, 'Cambridge syllabus code'),
  ...codedCourses([
    ['Mathematics', '0580'], ['Additional Mathematics', '0606'],
    ['Biology', '0610'], ['Chemistry', '0620'], ['Physics', '0625'],
    ['Computer Science', '0478'], ['First Language English', '0500'],
    ['Literature in English', '0475'], ['Economics', '0455'],
    ['Geography', '0460'], ['History', '0470'], ['French', '0520'],
  ], 'IGCSE', cambridgeIGCSESource, 'Cambridge syllabus code'),
];
const ibRows = [
  ['Mathematics Analysis and Approaches', '166711'],
  ['Mathematics Applications and Interpretation', '166712'],
  ['Biology', '100088'], ['Chemistry', '100113'], ['Physics', '100452'],
  ['Computer Science', '100132'], ['Geography', '100222'],
  ['Psychology', '100474'], ['Visual Arts', '100608'],
];
const ibCourses = ['SL', 'HL'].flatMap(level =>
  codedCourses(ibRows, level, ibSource, 'IB subject code'));
const apCourses = codedCourses([
  ['AP Calculus AB', '66'], ['AP Calculus BC', '68'], ['AP Statistics', '90'],
  ['AP Biology', '20'], ['AP Chemistry', '25'], ['AP Physics 1', '83'],
  ['AP Physics 2', '84'], ['AP Computer Science A', '31'],
  ['AP Computer Science Principles', '32'], ['AP English Language and Composition', '36'],
  ['AP Psychology', '85'], ['AP United States History', '07'],
], 'AP', apSource, 'AP exam code');

// Previously saved uncoded values remain valid session subjects.
const legacySubjects = [
  'Mathematics', 'Science', 'English', 'History', 'Languages', 'Other',
  'Further Mathematics', 'Biology', 'Chemistry', 'Physics', 'Economics',
  'Psychology', 'Computer Science', 'Visual Arts', 'Geography', 'Business',
  'Calculus', 'Statistics', 'Government', 'Art',
];
export const curriculumCatalog = [
  {
    id: 'ib-dp', name: 'IB Diploma Programme',
    subjects: ibCourses.map(course => course.value), courses: ibCourses,
    codeHint: 'Choose SL or HL. IB subject codes are shared across these levels.',
    sources: [{name: 'IB subject list', url: ibSource}],
  },
  {
    id: 'cambridge', name: 'Cambridge IGCSE / A Levels',
    subjects: cambridgeCourses.map(course => course.value), courses: cambridgeCourses,
    codeHint: 'Choose your qualification and exact syllabus code. Other grading variants can be added as custom subjects.',
    sources: [{name: 'Cambridge AS & A Level', url: cambridgeALevelSource}, {name: 'Cambridge IGCSE', url: cambridgeIGCSESource}],
  },
  {
    id: 'us', name: 'US High School / AP',
    subjects: [...apCourses.map(course => course.value), 'Mathematics', 'Science', 'English', 'History', 'Languages', 'Art'],
    courses: apCourses,
    codeHint: 'AP numbers identify exams in College Board records. Regular high school course codes vary by school.',
    sources: [{name: 'College Board AP exam codes', url: apSource}],
  },
  {
    id: 'turkiye', name: 'Türkiye — High School',
    subjects: ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'Turkish Language and Literature', 'History', 'Geography', 'Philosophy', 'English', 'Languages'],
    codeHint: 'Use your school’s course name or add its exact code as a custom subject.',
    sources: [],
  },
  {
    id: 'other', name: 'Other curriculum',
    subjects: ['Mathematics', 'Science', 'English', 'History', 'Languages', 'Other'],
    codeHint: 'Add subjects and course codes used by your school.',
    sources: [],
  },
];
export const sessionSubjects = new Set([
  ...legacySubjects,
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
