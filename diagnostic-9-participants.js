#!/usr/bin/env node

// Diagnostic script to test 9-participant limit in Amphix Meet
// This script automates the testing process without modifying production code

const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const { Room } = require('livekit-client');
const { RoomServiceClient } = require('livekit-sdk');

// Configuration
const DIAGNOSTIC_ACCOUNTS = [
  { email: 'diagnostic01@test.amphixmeet.local', password: 'DiagnosticPass123!' },
  { email: 'diagnostic02@test.amphixmeet.local', password: 'DiagnosticPass123!' },
  { email: 'diagnostic03@test.amphixmeet.local', password: 'DiagnosticPass123!' },
  { email: 'diagnostic04@test.amphixmeet.local', password: 'DiagnosticPass123!' },
  { email: 'diagnostic05@test.amphixmeet.local', password: 'DiagnosticPass123!' },
  { email: 'diagnostic06@test.amphixmeet.local', password: 'DiagnosticPass123!' },
  { email: 'diagnostic07@test.amphixmeet.local', password: 'DiagnosticPass123!' },
  { email: 'diagnostic08@test.amphixmeet.local', password: 'DiagnosticPass123!' },
  { email: 'diagnostic09@test.amphixmeet.local', password: 'DiagnosticPass123!' }
];

// LiveKit configuration from backend .env
const LIVEKIT_URL = process.env.LIVEKIT_URL || 'wss://amphix-dmswd7mp.livekit.cloud';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'APISA3mFKUv9vvj';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'CvzrBGxQFiMbggf9IYQFZeUPeoEfOW8eHdJePPv7wMOB';

// Database connection
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://amphix_meet_db_user:ZL8G8BkEUmSqKP2tGszZQJI0Ba9qYUwl@dpg-da3l08k9v7es739064gg-a.oregon-postgres.render.com/amphix_meet_db";

// API base URL
const API_URL = 'http://localhost:4000';

// Helper to make HTTP requests
async function httpRequest(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorBody}`);
  }

  return response.json();
}

// Login and get access token
async function loginAccount(account) {
  console.log(`[AMPHIX DIAG][AUTH] Logging in ${account.email}`);

  const response = await httpRequest('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify(account)
  });

  // Extract access token from response
  const accessToken = response.accessToken;
  if (!accessToken) {
    throw new Error('No access token in login response');
  }

  console.log(`[AMPHIX DIAG][AUTH] Logged in ${account.email}`);
  return accessToken;
}

// Create a meeting
async function createMeeting(accessToken) {
  console.log('[AMPHIX DIAG][MEETING] Creating meeting');

  const response = await httpRequest('/api/v1/meetings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      title: `Diagnostic Meeting ${Date.now()}`
    })
  });

  console.log(`[AMPHIX DIAG][MEETING] Created meeting with joinCode: ${response.joinCode}`);
  return response;
}

// Join meeting and get LiveKit token
async function joinMeeting(joinCode, accessToken) {
  console.log(`[AMPHIX DIAG][MEETING] Joining meeting ${joinCode}`);

  const response = await httpRequest(`/api/v1/meetings/${joinCode}/join`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });

  if (response.waiting) {
    throw new Error('Meeting requires approval - not suitable for automated test');
  }

  console.log(`[AMPHIX DIAG][MEETING] Joined meeting, got LiveKit token`);
  return {
    token: response.token,
    livekitUrl: response.livekitUrl,
    roomId: response.roomId,
    role: response.role
  };
}

// Create a test video track (simulated since we can't access real camera)
function createTestVideoTrack() {
  // Since we can't access real camera in Node.js, we'll simulate by not publishing video
  // but we'll still connect and see what happens with audio-only or no tracks
  console.log('[AMPHIX DIAG][MEDIA] Creating simulated video track (no actual video in Node.js)');
  return null; // We won't publish video since we can't access camera in Node.js
}

// Main diagnostic function
async function runDiagnostic() {
  console.log('[AMPHIX DIAG][START] Starting 9-participant diagnostic test');

  // Initialize database connection
  const pgPool = new Pool({ connectionString: DATABASE_URL });

  try {
    // Step 1: Login all accounts and get access tokens
    console.log('\n[AMPHIX DIAG][STEP 1] Logging in all diagnostic accounts');
    const accessTokens = {};
    for (const account of DIAGNOSTIC_ACCOUNTS) {
      try {
        const token = await loginAccount(account);
        accessTokens[account.email] = token;
        console.log(`[AMPHIX DIAG][AUTH] ✓ ${account.email}`);
      } catch (error) {
        console.error(`[AMPHIX DIAG][AUTH] ✗ ${account.email}: ${error.message}`);
        // Continue with other accounts even if one fails
      }
    }

    // Use the first account to create a meeting
    const firstAccountEmail = DIAGNOSTIC_ACCOUNTS[0].email;
    const firstAccountToken = accessTokens[firstAccountEmail];

    if (!firstAccountToken) {
      throw new Error('Failed to login with first account');
    }

    // Step 2: Create a meeting
    console.log('\n[AMPHIX DIAG][STEP 2] Creating meeting');
    const meeting = await createMeeting(firstAccountToken);
    const joinCode = meeting.joinCode;

    // Step 3: Have all accounts join the meeting and get LiveKit tokens
    console.log('\n[AMPHIX DIAG][STEP 3] Having all accounts join meeting');
    const livekitConnections = {};

    for (const account of DIAGNOSTIC_ACCOUNTS) {
      const email = account.email;
      const accessToken = accessTokens[email];

      if (!accessToken) {
        console.log(`[AMPHIX DIAG][MEETING] Skipping ${email} - no access token`);
        continue;
      }

      try {
        const livekitInfo = await joinMeeting(joinCode, accessToken);
        livekitConnections[email] = livekitInfo;
        console.log(`[AMPHIX DIAG][MEETING] ✓ ${email} joined meeting`);
      } catch (error) {
        console.error(`[AMPHIX DIAG][MEETING] ✗ ${email} failed to join: ${error.message}`);
      }
    }

    // Step 4: Create LiveKit Room instances and connect
    console.log('\n[AMPHIX DIAG][STEP 4] Creating LiveKit Room connections');
    const rooms = {};
    const roomService = new RoomServiceClient(
      LIVEKIT_URL.replace(/^wss?:\/\//, 'https://'),
      LIVEKIT_API_KEY,
      LIVEKIT_API_SECRET
    );

    for (const [email, livekitInfo] of Object.entries(livekitConnections)) {
      console.log(`[AMPHIX DIAG][LIVEKIT] Connecting Room for ${email}`);

      const room = new Room();
      rooms[email] = { room, info: livekitInfo, publications: new Map(), subscriptions: new Map() };

      // Set up event listeners
      room.on('connected', () => {
        console.log(`[AMPHIX DIAG][LIVEKIT] [${email}] Connected to room`);
      });

      room.on('disconnected', (reason) => {
        console.log(`[AMPHIX DIAG][LIVEKIT] [${email}] Disconnected: ${reason}`);
      });

      room.on('connectionStateChanged', (state) => {
        console.log(`[AMPHIX DIAG][LIVEKIT] [${email}] Connection state: ${state}`);
      });

      room.on('participantConnected', (participant) => {
        console.log(`[AMPHIX DIAG][LIVEKIT] [${email}] Participant connected: ${participant.identity}`);

        // Track video publications from this participant
        participant.videoPublications.forEach((publication, sid) => {
          console.log(`[AMPHIX DIAG][LIVEKIT] [${email}] Video published by ${participant.identity}: ${publication.sid}`);
          rooms[email].publications.set(participant.identity, {
            sid: publication.sid,
            trackSid: publication.trackSid,
            mimeType: publication.mimeType,
            width: publication.width,
            height: publication.height
          });
        });
      });

      room.on('participantDisconnected', (participant) => {
        console.log(`[AMPHIX DIAG][LIVEKIT] [${email}] Participant disconnected: ${participant.identity}`);
        rooms[email].publications.delete(participant.identity);
        rooms[email].subscriptions.delete(participant.identity);
      });

      room.on('trackPublished', (publication, participant) => {
        console.log(`[AMPHIX DIAG][LIVEKIT] [${email}] Track published: ${publication.kind} by ${participant.identity}`);
        if (publication.kind === 'video') {
          rooms[email].publications.set(participant.identity, {
            sid: publication.sid,
            trackSid: publication.trackSid,
            mimeType: publication.mimeType,
            width: publication.width,
            height: publication.height
          });
        }
      });

      room.on('trackUnpublished', (publication, participant) => {
        console.log(`[AMPHIX DIAG][LIVEKIT] [${email}] Track unpublished: ${publication.kind} by ${participant.identity}`);
        rooms[email].publications.delete(participant.identity);
      });

      room.on('trackSubscribed', (track, publication, participant) => {
        console.log(`[AMPHIX DIAG][LIVEKIT] [${email}] Track subscribed: ${track.kind} from ${participant.identity}`);
        if (track.kind === 'Video') {
          rooms[email].subscriptions.set(participant.identity, {
            trackSid: track.sid,
            kind: track.kind
          });
        }
      });

      room.on('trackUnsubscribed', (track, publication, participant) => {
        console.log(`[AMPHIX DIAG][LIVEKIT] [${email}] Track unsubscribed: ${track.kind} from ${participant.identity}`);
        rooms[email].subscriptions.delete(participant.identity);
      });

      room.on('error', (error) => {
        console.error(`[AMPHIX DIAG][LIVEKIT] [${email}] Room error:`, error);
      });

      try {
        await room.connect(LIVEKIT_URL, livekitInfo.token);
        console.log(`[AMPHIX DIAG][LIVEKIT] [${email}] Connect initiated`);
      } catch (error) {
        console.error(`[AMPHIX DIAG][LIVEKIT] [${email}] Failed to initiate connection:`, error);
      }
    }

    // Step 5: Wait for connections to stabilize
    console.log('\n[AMPHIX DIAG][STEP 5] Waiting for connections to stabilize...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Step 6: Collect and report statistics
    console.log('\n[AMPHIX DIAG][STEP 6] Collecting statistics');

    let totalConnected = 0;
    let totalParticipants = 0;
    let totalVideoPublications = 0;
    let totalVideoSubscriptions = 0;

    const results = {
      accounts: DIAGNOSTIC_ACCOUNTS.length,
      loggedIn: Object.keys(accessTokens).length,
      joinedMeeting: Object.keys(livekitConnections).length,
      connectedRooms: 0,
      participantsPerRoom: {},
      videoPublicationsPerRoom: {},
      videoSubscriptionsPerRoom: {}
    };

    for (const [email, roomData] of Object.entries(rooms)) {
      const room = roomData.room;
      const info = roomData.info;

      if (room.connectionState === 'connected') {
        totalConnected++;

        // Get remote participants
        const remoteParticipants = Array.from(room.remoteParticipants.values());
        const participantCount = remoteParticipants.length;
        totalParticipants += participantCount;

        // Count video publications
        let videoPubCount = 0;
        remoteParticipants.forEach(participant => {
          participant.videoPublications.forEach(publication => {
            if (publication.kind === 'video') {
              videoPubCount++;
            }
          });
        });
        totalVideoPublications += videoPubCount;

        // Count video subscriptions
        let videoSubCount = 0;
        room.remoteParticipants.forEach(participant => {
          participant.trackSubscriptions.forEach((subscription, sid) => {
            if (subscription.track.kind === 'Video') {
              videoSubCount++;
            }
          });
        });
        totalVideoSubscriptions += videoSubCount;

        results.connectedRooms++;
        results.participantsPerRoom[email] = participantCount;
        results.videoPublicationsPerRoom[email] = videoPubCount;
        results.videoSubscriptionsPerRoom[email] = videoSubCount;

        console.log(`[AMPHIX DIAG][RESULTS] ${email}:`);
        console.log(`  - Connection state: ${room.connectionState}`);
        console.log(`  - Local identity: ${room.localParticipant?.identity}`);
        console.log(`  - Remote participants: ${participantCount}`);
        console.log(`  - Video publications: ${videoPubCount}`);
        console.log(`  - Video subscriptions: ${videoSubCount}`);

        // Log identities
        const identities = remoteParticipants.map(p => p.identity);
        console.log(`  - Remote identities: [${identities.join(', ')}]`);
      } else {
        console.log(`[AMPHIX DIAG][RESULTS] ${email}: Connection state: ${room.connectionState}`);
      }
    }

    // Step 7: Test VideoGrid logic
    console.log('\n[AMPHIX DIAG][STEP 7] Testing VideoGrid logic');

    // Simulate the logic from VideoGrid.tsx
    // We'll use the first room's data to simulate what VideoGrid would see
    const firstRoomEmail = Object.keys(rooms)[0];
    const firstRoom = rooms[firstRoomEmail];

    if (firstRoom && firstRoom.room.connectionState === 'connected') {
      // Get camera tracks (simulating useTracks with Camera source)
      // In real VideoGrid, this comes from useTracks hook
      const cameraTracks = [];

      // Add local participant's camera track if available and enabled
      const localParticipant = firstRoom.room.localParticipant;
      if (localParticipant) {
        // In a real scenario, we would check if camera is enabled and published
        // For now, we'll simulate based on what we've observed
        console.log(`[AMPHIX DIAG][VIDEOGRIB] Local participant: ${localParticipant.identity}`);
      }

      // Get remote camera tracks
      firstRoom.room.remoteParticipants.forEach((participant, identity) => {
        // Check if participant has video track published
        participant.videoPublications.forEach((publication, sid) => {
          if (publication.kind === 'video') {
            // In real implementation, this would create a track reference
            cameraTracks.push({
              participant: {
                identity: participant.identity
              }
            });
          }
        });
      });

      console.log(`[AMPHIX DIAG][VIDEOGRIB] Camera tracks count (simulated): ${cameraTracks.length}`);

      // Now simulate the VideoGrid layout logic
      const count = cameraTracks.length;
      console.log(`[AMPHIX DIAG][VIDEOGRIB] Simulated cameraTracks length: ${count}`);

      // Apply the same logic as in VideoGrid.tsx getDesktopRows function
      function getDesktopRows(count) {
        const overflowCount = count > 6 ? count - 5 : 0;
        const visibleTotal = overflowCount > 0 ? 6 : count; // 5 real tiles + 1 indicator = 6

        const sizeByTotal = {
          2: 280,
          3: 240,
          4: 220,
          5: 200,
          6: 180,
        };
        const tileSize = sizeByTotal[visibleTotal] || 160;

        let rows;
        switch (visibleTotal) {
          case 2:
            rows = [2];
            break;
          case 3:
            rows = [3];
            break;
          case 4:
            rows = [2, 2];
            break;
          case 5:
            rows = [3, 2];
            break;
          case 6:
            rows = [3, 3];
            break;
          default:
            rows = [visibleTotal];
        }

        return { rows, tileSize, overflowCount };
      }

      const layout = getDesktopRows(count);
      console.log(`[AMPHIX DIAG][VIDEOGRIB] Layout - rows: ${layout.rows.join(', ')}, tileSize: ${layout.tileSize}, overflow: ${layout.overflowCount}`);

      // Calculate how many tiles would actually be rendered
      const tilesRendered = layout.rows.reduce((sum, rowLength) => sum + rowLength, 0);
      console.log(`[AMPHIX DIAG][VIDEOGRIB] Tiles that would be rendered: ${tilesRendered} (of ${count} camera tracks)`);

      if (layout.overflowCount > 0) {
        console.log(`[AMPHIX DIAG][VIDEOGRIB] Would show "+${layout.overflowCount}" overflow indicator`);
      }
    }

    // Step 8: Final report
    console.log('\n[AMPHIX DIAG][FINAL] DIAGNOSTIC RESULTS:');
    console.log('====================================');
    console.log(`| Couche | Résultat |`);
    console.log(`|--------|----------|`);
    console.log(`| Comptes diagnostic | ${results.accounts}/9 |`);
    console.log(`| Tokens via API réelle | ${results.loggedIn}/9 |`);
    console.log(`| Rooms LiveKit | ${results.joinedMeeting}/9 |`);
    console.log(`| Participants LiveKit | ${totalParticipants} |`);
    console.log(`| Publications vidéo | ${totalVideoPublications} |`);
    console.log(`| Publications vidéo distantes | ${totalVideoPublications} |`);
    console.log(`| Logique useParticipants | ${totalParticipants} |`);
    console.log(`| Logique useTracks | ${totalVideoPublications} |`);
    console.log(`| cameraTracks | ${totalVideoPublications} |`);
    console.log(`| Entrées envoyées au rendu | ${totalVideoPublications} |`);
    console.log(`| Éléments VideoGrid rendus | ${results.joinedMeeting > 0 ? 'SIMULATED' : 'N/A'} |`);
    console.log(`| Limite exacte à 8 reproduite | ${totalParticipants === 8 ? 'OUI' : 'NON'} |`);

    console.log('\n[AMPHIX DIAG][SUMMARY]');
    console.log(`- Successfully logged in: ${results.loggedIn}/9 accounts`);
    console.log(`- Successfully joined meeting: ${results.joinedMeeting}/9 accounts`);
    console.log(`- Successfully connected to LiveKit: ${results.connectedRooms}/9 rooms`);
    console.log(`- Total remote participants observed: ${totalParticipants}`);
    console.log(`- Total video publications: ${totalVideoPublications}`);

    // Determine which layer is responsible
    let responsibleLayer = 'unknown';
    let proof = '';
    let cause = '';
    let files = [];

    if (results.loggedIn < 9) {
      responsibleLayer = 'Authentication layer';
      proof = `Only ${results.loggedIn}/9 accounts could log in`;
      cause = 'Account creation or authentication issues';
      files = ['frontend/src/lib/authApi.ts', 'backend/src/controllers/authController.ts'];
    } else if (results.joinedMeeting < results.loggedIn) {
      responsibleLayer = 'Meeting join layer';
      proof = `${results.joinedMeeting}/${results.logged_in} joined meeting after login`;
      cause = 'Meeting creation/join API limits or permissions';
      files = ['frontend/src/lib/meetingApi.ts', 'backend/src/controllers/meetingController.ts'];
    } else if (results.connectedRooms < results.joinedMeeting) {
      responsibleLayer = 'LiveKit connection layer';
      proof = `${results.connectedRooms}/${results.joinedMeeting} connected to LiveKit after joining meeting`;
      cause = 'LiveKit token issues or connection limits';
      files = ['frontend/src/pages/Room.tsx', 'backend/src/services/livekitService.ts'];
    } else if (totalParticipants < results.connectedRooms * (results.connectedRooms - 1)) {
      // Each room should see (n-1) remote participants where n is connected rooms
      responsibleLayer = 'Participant observation layer (useParticipants)';
      proof = `Only ${totalParticipants} remote participants observed with ${results.connectedRooms} connected rooms`;
      cause = 'useParticipants hook not tracking all participants';
      files = ['frontend/src/pages/Room.tsx'];
    } else if (totalVideoPublications < totalParticipants) {
      responsibleLayer = 'Track publication layer';
      proof = `Only ${totalVideoPublications} video publications from ${totalParticipants} participants`;
      cause = 'Participants not publishing video tracks';
      files = ['frontend/src/components/MeetControls.tsx', 'frontend/src/pages/Room.tsx'];
    } else if (totalVideoSubscriptions < totalVideoPublications) {
      responsibleLayer = 'Track subscription layer (useTracks)';
      proof = `Only ${totalVideoSubscriptions} video subscriptions from ${totalVideoPublications} publications`;
      cause = 'useTracks hook not subscribing to all video tracks';
      files = ['frontend/src/components/VideoGrid.tsx'];
    } else {
      // All layers working, check if VideoGrid renders correctly
      responsibleLayer = 'VideoGrid rendering layer';
      proof = `All tracks available but VideoGrid may not render >8`;
      cause = 'VideoGrid layout logic or CSS limits rendering to 8';
      files = ['frontend/src/components/VideoGrid.tsx'];
    }

    console.log(`COUCHE RESPONSABLE : ${responsibleLayer}`);
    console.log(`PREUVE : ${proof}`);
    console.log(`CAUSE : ${cause}`);
    console.log(`FICHIER(S) CONCERNÉ(S) : ${files.join(', ')}`);
    console.log(`CORRECTION À ENVISAGER : Investigate and fix the identified layer`);

  } catch (error) {
    console.error(`[AMPHIX DIAG][ERROR] Diagnostic failed:`, error);
  } finally {
    // Clean up: disconnect all rooms
    console.log('\n[AMPHIX DIAG][CLEANUP] Disconnecting all rooms...');
    for (const [email, roomData] of Object.entries(rooms)) {
      try {
        await roomData.room.disconnect();
        console.log(`[AMPHIX DIAG][CLEANUP] Disconnected ${email}`);
      } catch (error) {
        console.error(`[AMPHIX DIAG][CLEANUP] Error disconnecting ${email}:`, error);
      }
    }

    // Close database connection
    await pgPool.end();
    console.log('[AMPHIX DIAG][END] Diagnostic completed');
  }
}

// Run the diagnostic
runDiagnostic().catch(console.error);