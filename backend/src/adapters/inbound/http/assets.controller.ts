import { BadGatewayException, BadRequestException, Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { AssetUseCasesService } from '../../../application/use-cases/asset-use-cases.service';
import { AmountDto } from './dto/amount.dto';
import { FileDto } from './dto/file.dto';
import { RegisterAssetDto } from './dto/register-asset.dto';
import { VerifyFileDto } from './dto/verify-file.dto';
import { ApiKeyGuard } from './guards/api-key.guard';
import { ParsePositiveBigIntPipe } from './pipes/parse-positive-bigint.pipe';

@Controller()
export class AssetsController {
  constructor(private readonly assets: AssetUseCasesService) {}

  @Get('health')
  health() {
    return { status: 'ok' };
  }

  @Post('assets')
  @UseGuards(ApiKeyGuard)
  @HttpCode(202)
  async registerAsset(@Body() body: RegisterAssetDto) {
    return this.forward(() => this.assets.registerAsset(BigInt(body.assetId)));
  }

  @Get('assets/:id')
  getAsset(@Param('id', ParsePositiveBigIntPipe) id: bigint) {
    return this.forward(() => this.assets.getAssetInfo(id));
  }

  @Get('assets/:id/free')
  assetFree(@Param('id', ParsePositiveBigIntPipe) id: bigint) {
    return this.forward(() => this.assets.isAssetFree(id));
  }

  @Post('assets/:id/financing')
  @UseGuards(ApiKeyGuard)
  @HttpCode(202)
  requestFinancing(@Param('id', ParsePositiveBigIntPipe) id: bigint, @Body() body: AmountDto) {
    return this.forward(() => this.assets.requestFinancing(id, BigInt(body.amountWei)));
  }

  @Post('assets/:id/repay')
  @UseGuards(ApiKeyGuard)
  @HttpCode(202)
  repay(@Param('id', ParsePositiveBigIntPipe) id: bigint, @Body() body: AmountDto) {
    return this.forward(() => this.assets.repayAndRelease(id, BigInt(body.amountWei)));
  }

  @Get('accounts/flagged')
  flaggedAccounts() {
    return this.forward(() => this.assets.getFlaggedAccounts());
  }

  @Post('accounts/flagged/clear')
  @UseGuards(ApiKeyGuard)
  @HttpCode(202)
  clearFlaggedAccounts() {
    return this.forward(() => this.assets.clearFlaggedAccounts());
  }

  @Get('assets/:id/files')
  getFile(@Param('id', ParsePositiveBigIntPipe) id: bigint) {
    return this.forward(() => this.assets.getFileInfo(id));
  }

  @Post('assets/:id/files')
  @UseGuards(ApiKeyGuard)
  @HttpCode(202)
  registerFile(@Param('id', ParsePositiveBigIntPipe) id: bigint, @Body() body: FileDto) {
    return this.forward(() => this.assets.registerFile(id, body.fileURI, body.fileHash));
  }

  @Post('assets/:id/files/verify')
  verifyFile(@Param('id', ParsePositiveBigIntPipe) id: bigint, @Body() body: VerifyFileDto) {
    return this.forward(() => this.assets.verifyFile(id, body.fileHash));
  }

  private async forward<T>(call: () => Promise<T>) {
    try {
      return await call();
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadGatewayException(this.errorMessage(error));
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
