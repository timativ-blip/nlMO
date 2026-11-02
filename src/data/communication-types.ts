import type { LocalTrack } from 'livekit-client';
export interface Contact { id: string; name: string; photo?: string; active: boolean; role: string; position?: string }
export interface DirectMessage { id: string; seq?: string; conversationId: string; senderId: string; text: string; meetingId?: string | null; createdAt: string; deliveredAt?: string | null; readAt?: string | null; sendState?: 'sending' | 'error' }
export interface Conversation { id: string; peerId: string; lastMessage: DirectMessage | null; unread: number; peerOpenUntil?: string; typingUntil?: string }
export interface Meeting { id: string; ownerId: string; title: string; inviteOnly: boolean; locked: boolean; createdAt: string; scheduledAt: string | null; startsAt: string; notifyAll: boolean; phase: 'scheduled' | 'live' | 'ended' | 'cancelled'; canJoin: boolean; expiresAt: string; endedAt: string | null; active: boolean }
export type InvitationStatus = 'pending' | 'accepted' | 'joined' | 'declined' | 'cancelled' | 'expired';
export interface Invitation { id: string; meetingId: string; inviterId: string; userId: string; status: InvitationStatus; createdAt: string; updatedAt: string; expiresAt: string }
export interface MeetingParticipant { userId: string; identity: string; state: 'admitted' | 'joined' | 'left' | 'removed'; joinedAt?: string | null }
export interface MeetingDetail { meeting: Meeting; invitations: Invitation[]; participants: MeetingParticipant[] }
export interface MeetingMessage { id: string; seq: string; senderId: string; text: string; createdAt: string }
export interface MeetingDocumentContent { agenda: string; summary: string; decisions: string; actions: string }
export interface MeetingDocuments {
  meetingId: string; title: string; ownerId: string; responsibleId: string; canEdit: boolean; agenda: string; eligibleRecipients: number | null;
  draft: { content: MeetingDocumentContent; version: number; updatedAt: string | null } | null;
  published: { id: string; revision: number; draftVersion: number; content: MeetingDocumentContent; publishedAt: string; publishedBy: string; recipients: number } | null;
}
export interface MediaAdmission { token: string; url: string; identity: string; room: string; expiresIn: number }
export interface ActiveCall { meeting: Meeting; admission: MediaAdmission; tracks: LocalTrack[] }
export interface CommunicationIndex { serverTime: string; contacts: Contact[]; conversations: Conversation[]; unread: number; meetings: Meeting[]; invitations: Invitation[] }
export interface CommunicationState extends CommunicationIndex {
  userId: string; loading: boolean; ready: boolean; error: string; connected: boolean; clockOffset: number;
  videoReady: boolean; videoStatusLoaded: boolean; panelOpen: boolean; selected: string | null;
  messages: Record<string, DirectMessage[]>; hasOlder: Record<string, boolean>; threadLoading: boolean;
  details: Record<string, MeetingDetail>; prepId: string | null; minutesId: string | null; call: ActiveCall | null; callExpanded: boolean; callNotice: string;
}
