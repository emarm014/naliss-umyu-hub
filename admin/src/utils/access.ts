export function getFirstAccessibleRoute(permissions: any): string {
  if (!permissions) return '/login';
  if (permissions.can_manage_announcements) return '/announcements';
  if (permissions.can_manage_materials) return '/materials';
  if (permissions.can_manage_past_questions) return '/past-questions';
  if (permissions.can_manage_students) return '/students';
  if (permissions.can_manage_groups) return '/groups';
  if (permissions.can_manage_group_media) return '/group-media';
  if (permissions.can_manage_storage) return '/storage';
  if (permissions.can_manage_messaging) return '/messaging';
  if (permissions.can_manage_security) return '/security';
  if (permissions.can_manage_archives) return '/archive';
  if (permissions.can_manage_news) return '/news';
  if (permissions.can_manage_events) return '/events';
  return '/login';
}
