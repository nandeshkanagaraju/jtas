import type { OutboundNotification } from '@/lib/notifications/channels/types';

// Notification previews deliberately exclude job/customer details on lock screens.
const labels: Record<string, [string, string, string]> = {
  SUBTASK_ASSIGNED: ['New task assigned', 'புதிய பணி ஒதுக்கப்பட்டது', 'नया कार्य सौंपा गया'],
  SUBTASK_REASSIGNED: [
    'Task reassigned',
    'பணி மறுஒதுக்கீடு செய்யப்பட்டது',
    'कार्य फिर से सौंपा गया',
  ],
  DEADLINE_REMINDER: [
    'Task deadline approaching',
    'பணிக்கான காலக்கெடு நெருங்குகிறது',
    'कार्य की समय सीमा नज़दीक है',
  ],
  OVERDUE_MEMBER: ['Task overdue', 'பணியின் காலக்கெடு கடந்துவிட்டது', 'कार्य की समय सीमा बीत गई'],
  OVERDUE_MD: ['Task overdue', 'பணியின் காலக்கெடு கடந்துவிட்டது', 'कार्य की समय सीमा बीत गई'],
  PROBLEM_RAISED: [
    'A problem needs attention',
    'ஒரு சிக்கலுக்கு கவனம் தேவை',
    'एक समस्या पर ध्यान देना ज़रूरी है',
  ],
  PROBLEM_RESOLVED: ['Problem resolved', 'சிக்கல் தீர்க்கப்பட்டது', 'समस्या हल हो गई'],
  READY_TO_START: [
    'Your department can start',
    'உங்கள் துறை பணியைத் தொடங்கலாம்',
    'आपका विभाग काम शुरू कर सकता है',
  ],
  COMMITMENT_OPEN: [
    'Set your deadline within 24 hours',
    '24 மணி நேரத்திற்குள் காலக்கெடுவை நிர்ணயிக்கவும்',
    '24 घंटे के भीतर अपनी समय सीमा तय करें',
  ],
  COMMITMENT_REMINDER: [
    'Reminder: set your deadline',
    'நினைவூட்டல்: காலக்கெடுவை நிர்ணயிக்கவும்',
    'अनुस्मारक: अपनी समय सीमा तय करें',
  ],
  COMMITMENT_MISSED_MEMBER: [
    'Deadline commitment missed',
    'காலக்கெடு நிர்ணயிக்கும் நேரம் கடந்துவிட்டது',
    'समय सीमा तय करने का समय बीत गया',
  ],
  COMMITMENT_MISSED_MD: [
    'Deadline commitment missed',
    'காலக்கெடு நிர்ணயிக்கும் நேரம் கடந்துவிட்டது',
    'समय सीमा तय करने का समय बीत गया',
  ],
  DEADLINE_CHANGED: ['Deadline changed', 'காலக்கெடு மாற்றப்பட்டது', 'समय सीमा बदल गई'],
  PREDECESSOR_DATE_CHANGED: [
    'Upstream deadline changed',
    'முந்தைய பணியின் காலக்கெடு மாற்றப்பட்டது',
    'पिछले कार्य की समय सीमा बदल गई',
  ],
  COMMITMENT_MADE: [
    'Department deadline set',
    'துறையின் காலக்கெடு நிர்ணயிக்கப்பட்டது',
    'विभाग की समय सीमा तय हो गई',
  ],
  APPROVAL_REQUIRED: ['Approval required', 'ஒப்புதல் தேவை', 'मंज़ूरी आवश्यक है'],
  EXTENSION_REQUESTED: [
    'More time requested',
    'கூடுதல் நேரம் கோரப்பட்டது',
    'अतिरिक्त समय का अनुरोध',
  ],
  COMMENT_MENTION: [
    'You were mentioned in a comment',
    'கருத்தில் நீங்கள் குறிப்பிடப்பட்டுள்ளீர்கள்',
    'एक टिप्पणी में आपका उल्लेख किया गया',
  ],
  JOB_COMPLETED: ['Job completed', 'வேலை முடிக்கப்பட்டது', 'काम पूरा हो गया'],
  DAILY_DIGEST_MD: ['Daily summary ready', 'தினசரி சுருக்கம் தயார்', 'दैनिक सारांश तैयार है'],
};
export function pushMessage(notification: Pick<OutboundNotification, 'type'>, locale: string) {
  const index = locale === 'ta' ? 1 : locale === 'hi' ? 2 : 0;
  return {
    lang: locale === 'ta' || locale === 'hi' ? locale : 'en',
    title: `Jaraa · ${(labels[notification.type] ?? ['Work update', 'பணி புதுப்பிப்பு', 'कार्य अपडेट'])[index]}`,
    body: [
      'Open Jaraa to view the update.',
      'புதுப்பிப்பைக் காண Jaraa-வைத் திறக்கவும்.',
      'अपडेट देखने के लिए Jaraa खोलें।',
    ][index],
  };
}
