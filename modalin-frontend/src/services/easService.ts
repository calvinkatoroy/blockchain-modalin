import { EASAttestation } from '../types';

class EASService {
  async getAttestations(recipient: string): Promise<EASAttestation[]> {
    // Mock EAS attestations
    return [
      {
        id: '0xabc...123',
        schema: '0xbusiness_registration_schema',
        attester: '0xgov_attester',
        recipient,
        time: Date.now() - 86400000 * 150,
        data: { businessName: 'Warung Berkah', registrationId: 'UMKM-2023-001' }
      },
      {
        id: '0xdef...456',
        schema: '0xrevenue_proof_schema',
        attester: '0xbank_attester',
        recipient,
        time: Date.now() - 86400000 * 45,
        data: { monthlyRevenue: '15.5 ETH', currency: 'ETH' }
      }
    ];
  }

  async requestAttestation(schemaId: string) {
    console.log(`Requesting attestation for schema: ${schemaId}`);
    return true;
  }
}

export const easService = new EASService();
