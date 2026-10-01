import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { DevicesService } from './devices.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DeviceOrJwtAuthGuard } from '../auth/device-or-jwt.guard';
import { ClaimDeviceDto } from './dto/claim.dto';
import { PatchDeviceDto } from './dto/patch-device.dto';
import { PatchChannelDto } from './dto/patch-channel.dto';
import type { AuthRequest } from '../common/auth-request';
import { ExcelService } from '../excel/excel.service';
import { parseIsoDate, parseOptionalChannels } from '../common/util';

@Controller('devices')
export class DevicesController {
  constructor(
    private readonly devices: DevicesService,
    private readonly excel: ExcelService,
  ) {}

  @Post('claim')
  @UseGuards(JwtAuthGuard)
  claim(@Body() body: ClaimDeviceDto) {
    return this.devices.claim(body);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  list() {
    return this.devices.list();
  }

  @Get(':id/config')
  @UseGuards(DeviceOrJwtAuthGuard)
  config(@Param('id') id: string, @Req() req: AuthRequest) {
    return this.devices.getConfig(id, req);
  }

  @Get(':id/export.xlsx')
  @UseGuards(JwtAuthGuard)
  async exportXlsx(
    @Param('id') id: string,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('channel') channel: string | undefined,
    @Res() res: Response,
  ) {
    await this.excel.writeDeviceWorkbook(res, {
      deviceId: id,
      from: parseIsoDate(from, 'start time'),
      to: parseIsoDate(to, 'end time'),
      channels: parseOptionalChannels(channel),
    });
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  get(@Param('id') id: string) {
    return this.devices.get(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  patch(@Param('id') id: string, @Body() body: PatchDeviceDto) {
    return this.devices.patch(id, body);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  remove(@Param('id') id: string) {
    return this.devices.remove(id);
  }

  @Patch(':id/channels/:index')
  @UseGuards(JwtAuthGuard)
  patchChannel(
    @Param('id') id: string,
    @Param('index', ParseIntPipe) index: number,
    @Body() body: PatchChannelDto,
  ) {
    return this.devices.patchChannel(id, index, body);
  }
}
