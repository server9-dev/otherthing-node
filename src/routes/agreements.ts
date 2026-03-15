/**
 * Agreement Routes - CRUD + sign + check endpoints
 */

import { Request, Response } from 'express';
import { ethers } from 'ethers';
import { web3Service, AgreementType } from '../services/web3-service';
import { appwriteService } from '../services/appwrite-service';
import type { RouteDependencies } from './types';

export function registerAgreementRoutes(deps: RouteDependencies): void {
  const { app, localAuth } = deps;

  // Create agreement (on-chain + Appwrite mirror)
  app.post('/api/v1/workspaces/:id/agreements', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const { documentHash, title, type, expiresAt, required } = req.body;

    if (!documentHash || !title || type === undefined) {
      res.status(400).json({ error: 'documentHash, title, and type are required' });
      return;
    }

    try {
      // Determine agreement type
      const agreementTypeMap: Record<string, AgreementType> = {
        nda: AgreementType.NDA,
        tos: AgreementType.TOS,
        ip_assignment: AgreementType.IPAssignment,
        custom: AgreementType.Custom,
      };
      const agreementType = agreementTypeMap[type] ?? AgreementType.Custom;
      const expires = expiresAt ? Math.floor(new Date(expiresAt).getTime() / 1000) : 0;

      // Create on-chain
      const agreementId = await web3Service.createAgreement(
        workspaceId, documentHash, title, agreementType, expires, required ?? false
      );

      // Mirror to Appwrite
      if (appwriteService.isInitialized()) {
        try {
          await appwriteService.createAgreement({
            workspaceId,
            documentHash,
            title,
            type,
            issuerAddress: web3Service.address || '',
            expiresAt: expiresAt || undefined,
            required: required ?? false,
          });
        } catch (err) {
          console.warn('[Agreements] Appwrite mirror failed:', err);
        }
      }

      res.status(201).json({ success: true, agreementId });
    } catch (err) {
      res.status(500).json({ error: 'Failed to create agreement', details: String(err) });
    }
  });

  // List agreements for workspace
  app.get('/api/v1/workspaces/:id/agreements', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;

    try {
      // Try Appwrite first
      if (appwriteService.isInitialized()) {
        const result = await appwriteService.listAgreements(workspaceId);
        res.json({ agreements: result.documents });
        return;
      }

      // Fallback to on-chain
      const agreementIds = await web3Service.getAgreements(workspaceId);
      const agreements = await Promise.all(
        agreementIds.map(id => web3Service.getAgreement(id))
      );
      res.json({ agreements });
    } catch (err) {
      res.status(500).json({ error: 'Failed to list agreements', details: String(err) });
    }
  });

  // Sign agreement
  app.post('/api/v1/agreements/:agreementId/sign', localAuth, async (req: Request, res: Response) => {
    const agreementId = parseInt(req.params.agreementId as string);

    if (isNaN(agreementId)) {
      res.status(400).json({ error: 'Invalid agreement ID' });
      return;
    }

    try {
      const tx = await web3Service.signAgreement(agreementId);
      const receipt = await tx.wait();

      // Mirror signature to Appwrite
      if (appwriteService.isInitialized()) {
        try {
          await appwriteService.recordSignature({
            agreementId: String(agreementId),
            signerAddress: web3Service.address || '',
            txHash: receipt?.hash,
          });
        } catch (err) {
          console.warn('[Agreements] Appwrite signature mirror failed:', err);
        }
      }

      res.json({ success: true, txHash: receipt?.hash });
    } catch (err) {
      res.status(500).json({ error: 'Failed to sign agreement', details: String(err) });
    }
  });

  // Check if user has signed all required agreements
  app.get('/api/v1/workspaces/:id/agreements/check/:address', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const address = req.params.address as string;

    try {
      const hasSigned = await web3Service.hasSignedRequired(workspaceId, address);
      res.json({ hasSigned, address, workspaceId });
    } catch (err) {
      res.status(500).json({ error: 'Failed to check agreements', details: String(err) });
    }
  });

  // Get signatures for an agreement
  app.get('/api/v1/agreements/:agreementId/signatures', localAuth, async (req: Request, res: Response) => {
    const agreementId = parseInt(req.params.agreementId as string);

    try {
      // Try Appwrite first
      if (appwriteService.isInitialized()) {
        const result = await appwriteService.getSignatures(String(agreementId));
        res.json({ signatures: result.documents });
        return;
      }

      // Fallback to on-chain
      const signers = await web3Service.getAgreementSignatures(agreementId);
      res.json({ signatures: signers.map(s => ({ signerAddress: s })) });
    } catch (err) {
      res.status(500).json({ error: 'Failed to get signatures', details: String(err) });
    }
  });
}
