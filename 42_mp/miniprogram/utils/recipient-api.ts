import { request } from './request';

export type SavedRecipient = {
  relationId: string;
  recipientId: string;
  name: string;
  phone?: string | null;
  address?: string | null;
  relationType?: string | null;
  relationLabel?: string | null;
  isDefault?: boolean;
  preferredColors?: string | null;
  dislikedFlowers?: string | null;
  preferenceNote?: string | null;
  lastUsedAt?: string | null;
};

export function fetchSavedRecipients() {
  return request<{ recipients: SavedRecipient[] }>({
    url: '/recipients',
    method: 'GET',
  });
}
