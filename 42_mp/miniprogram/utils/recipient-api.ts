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
  birthday?: string | null;
  anniversary?: string | null;
  lastUsedAt?: string | null;
};

export type RecipientUpsertPayload = {
  name: string;
  phone?: string;
  address?: string;
  relationType?: string;
  relationLabel?: string;
  preferredColors?: string;
  dislikedFlowers?: string;
  preferenceNote?: string;
  birthday?: string;
  anniversary?: string;
  isDefault?: boolean;
};

export function fetchSavedRecipients() {
  return request<{ recipients: SavedRecipient[] }>({
    url: '/recipients',
    method: 'GET',
  });
}

export function createRecipient(payload: RecipientUpsertPayload) {
  return request<{
    relationId: string;
    recipientId: string;
    name: string;
  }>({
    url: '/recipients',
    method: 'POST',
    data: payload,
  });
}

export function updateRecipient(relationId: string, payload: Partial<RecipientUpsertPayload>) {
  return request<{ relationId: string; name: string }>({
    url: `/recipients/${relationId}`,
    method: 'PATCH',
    data: payload,
  });
}

export function deleteRecipient(relationId: string) {
  return request<{ relationId: string }>({
    url: `/recipients/${relationId}`,
    method: 'DELETE',
  });
}
