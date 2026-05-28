import { Module } from '@nestjs/common';
import { AssetsController } from './adapters/inbound/http/assets.controller';
import { ApiKeyGuard } from './adapters/inbound/http/guards/api-key.guard';
import { ViemAssetContractAdapter } from './adapters/outbound/blockchain/viem-asset-contract.adapter';
import { AssetUseCasesService } from './application/use-cases/asset-use-cases.service';
import { ASSET_CONTRACT_PORT } from './application/tokens';
import { AppConfigService } from './config/app-config.service';

@Module({
  controllers: [AssetsController],
  providers: [
    AppConfigService,
    AssetUseCasesService,
    ApiKeyGuard,
    {
      provide: ASSET_CONTRACT_PORT,
      useClass: ViemAssetContractAdapter,
    },
  ],
})
export class AppModule {}
