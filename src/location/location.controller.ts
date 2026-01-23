// src/location/location.controller.ts
import { Controller, Post, Body, UseGuards, Req, Get, Query } from '@nestjs/common';
import { LocationService } from './location.service';
import { JwtAuthGuard } from '../auth/jwt.guard';

@Controller('api/location')
export class LocationController {
    constructor(private readonly locationService: LocationService) { }

    @Post()
    @UseGuards(JwtAuthGuard)
    track(@Body() body, @Req() req) {
        return this.locationService.store(req.user.id, body);
    }

    @Get()
    @UseGuards(JwtAuthGuard)
    history(@Query() query) {
        return this.locationService.getHistory(
            query.employee_id,
            query.from,
            query.to
        );
    }
}
