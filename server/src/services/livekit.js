import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

export function livekitConfigured() {
  const url = process.env.LIVEKIT_URL || '';
  return Boolean(url.startsWith('wss://') && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);
}

function httpUrl() {
  return (process.env.LIVEKIT_URL || '').replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
}

function roomService() {
  return new RoomServiceClient(httpUrl(), process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
}

export async function createLiveRoom(roomName) {
  await roomService().createRoom({ name: roomName, emptyTimeout: 15 * 60, maxParticipants: 50 });
}

export async function deleteLiveRoom(roomName) {
  try {
    await roomService().deleteRoom(roomName);
  } catch (error) {
    if (!/not found|does not exist|404/i.test(String(error?.message || ''))) {
      console.error('LiveKit room cleanup failed:', error?.message || error);
    }
  }
}

export async function createLiveToken(user, roomName) {
  const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
    identity: `user-${user._id}`,
    name: user.profile?.fullName || user.username,
    ttl: process.env.LIVEKIT_TOKEN_TTL || '6h',
    metadata: JSON.stringify({ role: user.role, avatarUrl: user.profile?.avatarUrl || '' })
  });
  token.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true, canPublishData: true });
  return token.toJwt();
}
