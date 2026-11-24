import { Module } from '@nestjs/common';
import { AccountsService } from './accounts.service.js';
import { LedgerService } from './ledger.service.js';

@Module({
  providers: [LedgerService, AccountsService],
  exports: [LedgerService, AccountsService],
})
export class LedgerModule {}
