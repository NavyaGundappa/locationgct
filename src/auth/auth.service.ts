import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

// TEMP USER STORE (replace with DynamoDB later)
const users = [
    { id: '200232', password: '1234', role: 'managerdashboard' },
    { id: '200235', password: '1234', role: 'hrdashboard' },
];

@Injectable()
export class AuthService {
    constructor(private jwtService: JwtService) { }

    async login(data: { employeeId: string; password: string }) {
        const user = users.find(
            u => u.id === data.employeeId && u.password === data.password,
        );

        if (!user) {
            throw new UnauthorizedException('Invalid credentials');
        }

        const payload = {
            sub: user.id,
            role: user.role,
        };

        return {
            token: this.jwtService.sign(payload),
            employeeId: user.id,
            dashboardType: user.role,
        };
    }
}
